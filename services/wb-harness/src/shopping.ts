const shoppingIntent =
  /(найд|поищ|ищ[уе]|подбер|посовет|покаж|скин|скинь|дай|давай|хочу|хотел|нужн|куп|закаж|сколько\s+сто|почём|почем|цен[аыу]|товар|каталог|артикул|ссылк|карточк)/iu

const greeting =
  /^(привет|здравствуй(?:те)?|доброе\s+утро|добрый\s+день|добрый\s+вечер|спасибо|пока|да|нет|ок|окей|хорошо|понял|поняла)(?=$|[\s,.!?])/iu

const chatVerb =
  /^(помоги(?:те)?|расскажи(?:те)?|объясни(?:те)?|переведи(?:те)?|напиши(?:те)?|сделай(?:те)?|можешь|можно)(?=$|[\s,.!?])/iu

const chatStop =
  /^(продолжай|продолжи|продолжить|дальше|далее|ещё|еще|стоп|хватит|отмена|отмени|заново)(?=$|[\s,.!?])/iu

const questionStart =
  /^(что|как|почему|зачем|кто|где|когда|какой|какая|какое|какие|сколько|можно|можешь|помоги)(?=$|[\s,.!?])/iu

const codeMarker =
  /(файл|код|функци|переменн|класс|модул|пакет|репозитор|ветк|коммит|терминал|команд|shell|bash|скрипт|парсер|метод|хук|компонент|эндпоинт|миграц|схем|запрос|ошибк|стек|сервер|сборк|билд|тест|логи|конфиг|git|npm|bun|pnpm|yarn|docker|make|import|export|const|let|var|def|sql|regex|readme|package|tsx|jsx|json|yaml|toml|\.ts\b|\.js\b|\.md\b|\.py\b|\.go\b|\.rs\b)/iu

const pathMarker = /(?:^|[\s(«"'])(?:[\w./@-]*\/[\w./@-]+|[\w.-]+\.\w{1,6})(?=$|[\s)»"',:;])/u

const bareProduct = /^[\p{L}\p{N}][\p{L}\p{N}\s-]{0,80}$/u

/**
 * True when the user is asking for products rather than for code work.
 * Used to keep coding tool planning from hijacking shopping queries:
 * "найди носки" must search the catalog, not grep the project for "носки".
 */
export function isShoppingQuery(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  if (pathMarker.test(value) || codeMarker.test(value)) return false
  if (chatStop.test(value)) return false
  if (shoppingIntent.test(value)) return true
  if (greeting.test(value) || questionStart.test(value) || chatVerb.test(value)) return false
  return bareProduct.test(value) && value.split(/\s+/).length <= 5
}
