export type WBProduct = {
  id: number
  name: string
  brand?: string
  priceRub?: number
  rating?: number
  feedbacks?: number
  url: string
}

export function productURL(id: number): string {
  return `https://www.wildberries.ru/catalog/${id}/detail.aspx`
}

/** Rebuilds a card from a product URL, used when only the link tool ran. */
export function productFromURL(url: string): WBProduct | undefined {
  const match = url.match(/catalog\/(\d+)\//)
  if (!match?.[1]) return
  const id = Number(match[1])
  return { id, name: `Артикул ${id}`, url: productURL(id) }
}

/**
 * Reads the product arrays shared by the catalog endpoints and the assistant's
 * `search` SSE event. Both wrap items as `products` or `data.products`.
 */
export function readProducts(payload: unknown): WBProduct[] {
  const products = readPath(payload, ["data", "products"]) ?? readPath(payload, ["products"])
  if (!Array.isArray(products)) return []

  return products.flatMap((raw) => {
    if (!isRecord(raw)) return []
    const id = typeof raw.id === "number" ? raw.id : Number(raw.id)
    if (!Number.isFinite(id)) return []
    const name = typeof raw.name === "string" ? raw.name : `Артикул ${id}`
    const brand = typeof raw.brand === "string" && raw.brand.trim() ? raw.brand : undefined
    return [
      {
        id,
        name,
        brand,
        priceRub: readPrice(raw),
        rating: typeof raw.reviewRating === "number" ? raw.reviewRating : undefined,
        feedbacks: typeof raw.feedbacks === "number" ? raw.feedbacks : undefined,
        url: productURL(id),
      },
    ]
  })
}

export function formatProducts(products: WBProduct[]): string {
  return products.map(formatProduct).join("\n")
}

/** A short, deterministic link list appended when the model omits product URLs. */
export function formatProductLinks(products: WBProduct[], limit = 5): string {
  if (!products.length) return ""
  return [
    "Ссылки на товары:",
    ...products.slice(0, limit).map((product) => `- ${formatProduct(product)}`),
  ].join("\n")
}

/**
 * Appends links the model failed to mention. The assistant often describes
 * products without URLs even though its `search` event carries full cards.
 */
export function appendProductLinks(text: string, products: WBProduct[]): string {
  const missing = products.filter((product) => !text.includes(product.url))
  if (!missing.length) return text
  const links = formatProductLinks(missing)
  if (!links) return text
  const base = text.trimEnd()
  return base ? `${base}\n\n${links}` : links
}

function formatProduct(product: WBProduct): string {
  const price = product.priceRub ? `${product.priceRub.toFixed(0)} ₽` : "цена не указана"
  const brand = product.brand ? `${product.brand} ` : ""
  const rating =
    product.rating && product.feedbacks
      ? `, рейтинг ${product.rating.toFixed(1)} (${product.feedbacks} отзывов)`
      : ""
  return `${brand}${product.name} — ${price}${rating}; ${product.url}`
}

function readPrice(raw: Record<string, unknown>): number | undefined {
  const sizes = Array.isArray(raw.sizes) ? raw.sizes : []
  for (const size of sizes) {
    if (!isRecord(size)) continue
    const price = isRecord(size.price) ? size.price : undefined
    if (!price) continue
    const total = price.total ?? price.product ?? price.basic
    if (typeof total === "number" && total > 0) return normalizeKopecks(total)
  }
  const salePrice = isRecord(raw.salePriceU) ? undefined : raw.salePriceU
  if (typeof salePrice === "number" && salePrice > 0) return normalizeKopecks(salePrice)
  return
}

/** WB price fields are kopecks; older payloads already come in rubles. */
function normalizeKopecks(value: number): number {
  return value >= 10000 ? value / 100 : value
}

function readPath(payload: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!isRecord(current)) return
    return current[key]
  }, payload)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
