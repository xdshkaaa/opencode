import { describe, expect, test } from "bun:test"
import { isShoppingQuery } from "../src/shopping"

describe("isShoppingQuery", () => {
  test("recognises product requests", () => {
    expect(isShoppingQuery("найди носки")).toBe(true)
    expect(isShoppingQuery("скинь ссылку на артикул 123456")).toBe(true)
    expect(isShoppingQuery("сколько стоят мужские носки")).toBe(true)
    expect(isShoppingQuery("подбери кроссовки Nike")).toBe(true)
    expect(isShoppingQuery("носки")).toBe(true)
    expect(isShoppingQuery("носки мужские хлопок")).toBe(true)
  })

  test("does not treat code work as shopping", () => {
    expect(isShoppingQuery("прочитай файл package.json")).toBe(false)
    expect(isShoppingQuery("запусти git status")).toBe(false)
    expect(isShoppingQuery("найди функцию parseArguments")).toBe(false)
    expect(isShoppingQuery("найди все файлы *.ts")).toBe(false)
    expect(isShoppingQuery("здесь есть носки.ts?")).toBe(false)
  })

  test("ignores small talk and questions", () => {
    expect(isShoppingQuery("привет")).toBe(false)
    expect(isShoppingQuery("как дела")).toBe(false)
    expect(isShoppingQuery("что такое носки")).toBe(false)
    expect(isShoppingQuery("спасибо")).toBe(false)
    expect(isShoppingQuery("продолжай")).toBe(false)
  })
})
