import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHarness, type HarnessState } from "../src/server"
import { registerShoppingTools } from "../src/tools/enrich"
import type { WBConfig } from "../src/config"

const requests: string[] = []

const upstream = Bun.serve({
  port: 0,
  async fetch(request) {
    const raw = await request.text()
    requests.push(raw)
    const refused = raw.includes("ОТКАЗ")
    const searched = raw.includes("носки")
    const frames = refused
      ? [
          { type: "text", data: { block_position: "single", text: "Извините, я не могу предоставить такой ответ." } },
          {
            type: "scenario_info",
            data: { scenario: "moderation_blocked", state_manager: { state: "ignored" } },
          },
        ]
      : [
          {
            type: "system_info",
            data: {
              session_id: "session-from-upstream",
              event: { message_id: "m1", sender: "user" },
            },
          },
          ...(searched
            ? [
                {
                  type: "search",
                  data: {
                    snippet_type: "products_base",
                    payload: {
                      search: {
                        products: [
                          {
                            id: 1073560311,
                            name: "Носки мужские спортивные черные высокие комплект 5 пар",
                            brand: "LEGAS",
                            reviewRating: 4.8,
                            feedbacks: 117,
                            sizes: [{ price: { total: 35100 } }],
                          },
                        ],
                      },
                    },
                  },
                },
              ]
            : []),
          { type: "text", data: { block_position: "start", text: "Первый " } },
          { type: "text", data: { block_position: "end", text: "ответ." } },
          {
            type: "scenario_info",
            data: { scenario: "chat", state_manager: { state: "success" } },
          },
        ]

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        for (const frame of frames) {
          controller.enqueue(encoder.encode(`id: 1\nevent: chunk\ndata: ${JSON.stringify(frame)}\n\n`))
        }
        controller.close()
      },
    })
    return new Response(body, { headers: { "content-type": "text/event-stream" } })
  },
})

const config: WBConfig = {
  port: 0,
  hostname: "127.0.0.1",
  upstream: `http://127.0.0.1:${upstream.port}/chat`,
  auth: { token: "token", userdata: "userdata", source: "env" },
  enrichment: { enabled: true, timeoutMs: 2000 },
  session: { reuse: true },
}

const state: HarnessState = { startedAt: Date.now() }
const harness = Bun.serve({
  port: 0,
  fetch: createHarness(config, state),
})

const anonymous = Bun.serve({
  port: 0,
  fetch: createHarness({ ...config, auth: { token: "", userdata: "", source: "none" } }, { startedAt: Date.now() }),
})

// Catalog enrichment is off here so the test never reaches the network.
const offline = Bun.serve({
  port: 0,
  fetch: createHarness(
    { ...config, enrichment: { enabled: false, timeoutMs: 2000 } },
    { startedAt: Date.now() },
  ),
})

function url(path: string) {
  return `http://127.0.0.1:${harness.port}${path}`
}

function offlineURL(path: string) {
  return `http://127.0.0.1:${offline.port}${path}`
}

beforeAll(() => registerShoppingTools())
afterAll(() => {
  harness.stop(true)
  anonymous.stop(true)
  offline.stop(true)
  upstream.stop(true)
})

describe("wb-harness", () => {
  test("reports missing credentials", async () => {
    const response = await fetch(`http://127.0.0.1:${anonymous.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "привет" }] }),
    })

    expect(response.status).toBe(401)
  })

  test("returns enriched completion and injects tool context upstream", async () => {
    requests.length = 0

    const response = await fetch(url("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "wb-agent",
        messages: [{ role: "user", content: "Что дешевле: 2 за 300 ₽ или 4 за 400 ₽?" }],
      }),
    })

    const body = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
      wb_harness: { tools: string[] }
    }

    expect(response.status).toBe(200)
    expect(body.choices[0]?.message.content).toBe("Первый ответ.")
    expect(body.wb_harness.tools).toContain("wb_compare_unit_prices")

    const sent = JSON.parse(requests[0] ?? "{}") as { text?: string; idempotency_key?: string }
    expect(sent.idempotency_key).toBeString()
    expect(sent.text).toContain("Справочные сведения")
    expect(sent.text).toContain("Вопрос покупателя: Что дешевле")
  })

  test("streams OpenAI chunks", async () => {
    const response = await fetch(url("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: "user", content: "привет" }],
      }),
    })

    const text = await response.text()
    expect(text).toContain('"object":"chat.completion.chunk"')
    expect(text).toContain("data: [DONE]")
  })

  test("proxies the Wildberries endpoint and exposes tool header", async () => {
    const response = await fetch(url("/api/chat/v5/message"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "дай ссылку на артикул 123456" }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("x-harness-tools")).toContain("wb_product_link")
    expect(await response.text()).toContain('"type":"text"')
  })

  test("rejects WB requests without text", async () => {
    const response = await fetch(url("/api/chat/v5/message"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
  })

  test("exposes health and models", async () => {
    const health = (await (await fetch(url("/health"))).json()) as { tools: string[] }
    expect(health.tools).toContain("wb_product_link")

    const models = (await (await fetch(url("/v1/models"))).json()) as { data: Array<{ id: string }> }
    expect(models.data[0]?.id).toBe("wb-agent")
  })

  test("returns OpenAI tool_calls for a read request", async () => {
    const response = await fetch(url("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "прочитай файл package.json" }],
        tools: [
          { type: "function", function: { name: "read", description: "Read a file", parameters: {} } },
          { type: "function", function: { name: "bash", description: "Run a command", parameters: {} } },
        ],
      }),
    })

    const body = (await response.json()) as {
      choices: Array<{
        finish_reason: string
        message: { content: null; tool_calls: Array<{ function: { name: string; arguments: string } }> }
      }>
    }

    expect(body.choices[0]?.finish_reason).toBe("tool_calls")
    const call = body.choices[0]?.message.tool_calls[0]
    expect(call?.function.name).toBe("read")
    expect(JSON.parse(call?.function.arguments ?? "{}").filePath).toBe("package.json")
  })

  test("streams tool_calls", async () => {
    const response = await fetch(url("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: "user", content: "запусти git status" }],
        tools: [{ type: "function", function: { name: "bash", description: "Run a command", parameters: {} } }],
      }),
    })

    const text = await response.text()
    expect(text).toContain('"tool_calls"')
    expect(text).toContain("git status")
    expect(text).toContain('"finish_reason":"tool_calls"')
  })

  test("answers with content after tool results", async () => {
    const response = await fetch(url("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "прочитай файл package.json" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_1", function: { name: "read", arguments: '{"filePath":"package.json"}' } },
            ],
          },
          { role: "tool", tool_call_id: "call_1", name: "read", content: '{"name":"demo"}' },
        ],
        tools: [{ type: "function", function: { name: "read", description: "Read a file", parameters: {} } }],
      }),
    })

    const body = (await response.json()) as {
      choices: Array<{ finish_reason: string; message: { role: string; content: string } }>
    }

    expect(body.choices[0]?.finish_reason).toBe("stop")
    expect(body.choices[0]?.message.content).toBe("Первый ответ.")
  })

  test("falls back to tool output when the assistant refuses", async () => {
    const response = await fetch(url("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "запусти git status" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_2", function: { name: "bash", arguments: '{"command":"git status"}' } },
            ],
          },
          { role: "tool", tool_call_id: "call_2", name: "bash", content: "ОТКАЗ: On branch dev" },
        ],
        tools: [{ type: "function", function: { name: "bash", description: "Run", parameters: {} } }],
      }),
    })

    const body = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
      wb_harness: { fallback?: boolean }
    }

    expect(body.wb_harness.fallback).toBe(true)
    expect(body.choices[0]?.message.content).toContain("bash:")
    expect(body.choices[0]?.message.content).toContain("On branch dev")
  })

  test("searches products instead of calling grep and appends links", async () => {
    const response = await fetch(offlineURL("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "wb-agent",
        messages: [{ role: "user", content: "найди носки" }],
        tools: [{ type: "function", function: { name: "grep", description: "Search files", parameters: {} } }],
      }),
    })

    const body = (await response.json()) as {
      choices: Array<{ finish_reason: string; message: { content: string } }>
      wb_harness: { products: Array<{ id: number; url: string }> }
    }

    expect(body.choices[0]?.finish_reason).toBe("stop")
    expect(body.choices[0]?.message.content).toContain("Ссылки на товары:")
    expect(body.choices[0]?.message.content).toContain(
      "https://www.wildberries.ru/catalog/1073560311/detail.aspx",
    )
    expect(body.wb_harness.products[0]?.id).toBe(1073560311)
  })

  test("appends the article link even when the model omits it", async () => {
    const response = await fetch(url("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "дай ссылку на артикул 987654321" }],
      }),
    })

    const body = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
      wb_harness: { products: Array<{ id: number }> }
    }

    expect(body.choices[0]?.message.content).toContain(
      "https://www.wildberries.ru/catalog/987654321/detail.aspx",
    )
    expect(body.wb_harness.products[0]?.id).toBe(987654321)
  })

  test("still plans coding tools for a code search", async () => {
    const response = await fetch(offlineURL("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "найди функцию parseArguments" }],
        tools: [{ type: "function", function: { name: "grep", description: "Search files", parameters: {} } }],
      }),
    })

    const body = (await response.json()) as {
      choices: Array<{ finish_reason: string; message: { tool_calls: Array<{ function: { name: string } }> } }>
    }

    expect(body.choices[0]?.finish_reason).toBe("tool_calls")
    expect(body.choices[0]?.message.tool_calls[0]?.function.name).toBe("grep")
  })
})
