import { describe, expect, test } from "bun:test"
import { appendProductLinks, formatProductLinks, readProducts } from "../src/wb/products"

const payload = {
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
          sizes: [{ price: { basic: 140000, product: 35100, total: 35100 } }],
        },
        { id: "123456789", name: "Носки женские", brand: "", sizes: [] },
      ],
    },
  },
}

describe("readProducts", () => {
  test("parses the assistant's search payload", () => {
    const products = readProducts(payload.payload.search)

    expect(products).toHaveLength(2)
    expect(products[0]?.id).toBe(1073560311)
    expect(products[0]?.priceRub).toBe(351)
    expect(products[0]?.url).toBe("https://www.wildberries.ru/catalog/1073560311/detail.aspx")
    expect(products[0]?.brand).toBe("LEGAS")
    expect(products[1]?.priceRub).toBeUndefined()
    expect(products[1]?.brand).toBeUndefined()
  })

  test("returns nothing for an unexpected shape", () => {
    expect(readProducts({ items: [] })).toEqual([])
    expect(readProducts(null)).toEqual([])
  })
})

describe("links", () => {
  const products = readProducts(payload.payload.search)

  test("formats a readable list", () => {
    const links = formatProductLinks(products)

    expect(links).toContain("Ссылки на товары:")
    expect(links).toContain("351 ₽")
    expect(links).toContain(products[0]!.url)
  })

  test("appends only missing links", () => {
    const answer = `Носки есть. ${products[0]!.url}`
    const withLinks = appendProductLinks(answer, products)

    expect(withLinks).toContain(products[1]!.url)
    expect(withLinks.match(new RegExp(products[0]!.url, "g"))).toHaveLength(1)
  })

  test("leaves text alone when every link is present", () => {
    const answer = products.map((product) => product.url).join("\n")
    expect(appendProductLinks(answer, products)).toBe(answer)
  })
})
