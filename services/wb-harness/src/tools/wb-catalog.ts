import { readProducts, type WBProduct } from "../wb/products"

export type CatalogProduct = WBProduct

const searchHosts = [
  "https://search.wb.ru/exactmatch/ru/common/v13/search",
  "https://search.wb.ru/exactmatch/ru/common/v9/search",
]

const defaultParams = {
  appType: "1",
  curr: "rub",
  dest: "-1257786",
  lang: "ru",
  resultset: "catalog",
  spp: "30",
}

export async function searchProducts(
  query: string,
  signal: AbortSignal,
  limit = 5,
): Promise<CatalogProduct[]> {
  const errors: string[] = []
  for (const host of searchHosts) {
    const url = new URL(host)
    for (const [key, value] of Object.entries(defaultParams)) url.searchParams.set(key, value)
    url.searchParams.set("query", query)
    url.searchParams.set("limit", String(limit))
    url.searchParams.set("page", "1")

    try {
      const response = await fetch(url, {
        signal,
        headers: {
          origin: "https://www.wildberries.ru",
          referer: "https://www.wildberries.ru/",
          "user-agent": "Mozilla/5.0",
        },
      })
      if (!response.ok) {
        errors.push(`${url.host} ${response.status}`)
        continue
      }
      const payload = (await response.json()) as unknown
      const products = readProducts(payload)
      if (products.length) return products
    } catch (error) {
      errors.push(`${url.host} ${error instanceof Error ? error.message : "failed"}`)
    }
  }
  throw new Error(`catalog search unavailable (${errors.join("; ")})`)
}

export async function productDetails(
  article: string,
  signal: AbortSignal,
): Promise<CatalogProduct | undefined> {
  const url = new URL("https://card.wb.ru/cards/v2/detail")
  url.searchParams.set("appType", "1")
  url.searchParams.set("curr", "rub")
  url.searchParams.set("dest", "-1257786")
  url.searchParams.set("spp", "30")
  url.searchParams.set("nm", article)

  const response = await fetch(url, {
    signal,
    headers: {
      origin: "https://www.wildberries.ru",
      referer: "https://www.wildberries.ru/",
      "user-agent": "Mozilla/5.0",
    },
  })
  if (!response.ok) throw new Error(`card endpoint ${response.status}`)
  return readProducts(await response.json())[0]
}
