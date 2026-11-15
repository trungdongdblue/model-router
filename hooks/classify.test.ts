import { describe, expect, test } from 'claude-code/testing'
import { classify, type Tier } from './classify'

// Sample prompts, English and Vietnamese, with the tier each should get.
const CASES: ReadonlyArray<[string, Tier]> = [
  // easy: short, routine, nothing to debug
  ['rename getUser to fetchUser in api.ts', 'easy'],
  ['fix the typo in README', 'easy'],
  ['add a docstring to parseConfig', 'easy'],
  ['What does git stash do?', 'easy'],
  ['explain this regex: ^\\d{3}-\\d{4}$', 'easy'],
  ['đổi tên biến data thành users', 'easy'],
  ['useEffect là gì?', 'easy'],
  ['sửa lỗi chính tả trong file README', 'easy'],
  // typed without diacritics, or after a greeting
  ['hello, git la gi', 'easy'],
  ['chào bạn, useEffect là gì?', 'easy'],
  ['doi ten bien data thanh users', 'easy'],
  ['hi, what does git stash do?', 'easy'],
  ['git log lam gi', 'easy'],
  ['lệnh git rebase dùng để làm gì?', 'easy'],

  // normal: everyday coding, left alone
  ['add a /health endpoint to the express server', 'normal'],
  ['write unit tests for the cart reducer', 'normal'],
  ['thêm nút đăng xuất vào header', 'normal'],
  ['tạo mới file config cho eslint', 'normal'],
  ['lỗi này phải làm gì để sửa trong file auth.ts', 'normal'],
  ['the login form does not submit when I press enter, fix it', 'normal'],
  // short "explain" but with a stack trace: debugging, not easy
  ['explain this error:\nTypeError: x is undefined\n    at main.js:10:5', 'normal'],
  // easy keyword but too long to be a quick change
  ['rename ' + 'the field across this one component and keep the props stable '.repeat(4), 'normal'],

  // hard: complex, ambiguous or wide in scope
  ['refactor the auth module to use dependency injection', 'hard'],
  ['migrate the project from webpack to vite', 'hard'],
  ['design the architecture for a multi-tenant billing service', 'hard'],
  ['find the root cause of the deadlock in the job queue', 'hard'],
  ['tests are flaky in CI, sometimes fails on the upload step', 'hard'],
  ['rename userId to accountId across all files', 'hard'],
  ['tái cấu trúc module thanh toán cho dễ test', 'hard'],
  ['tai cau truc module thanh toan', 'hard'],
  ['lập kế hoạch nâng cấp từ React 17 lên React 19', 'hard'],
  ['app lúc được lúc không khi gọi API, tìm nguyên nhân gốc', 'hard'],
  ['x'.repeat(9000), 'hard'],
]

describe('classify', () => {
  for (const [prompt, tier] of CASES) {
    test(`${tier}: ${prompt.slice(0, 50).replace(/\n/g, ' ')}`, async () => {
      expect(classify(prompt).tier).toBe(tier)
    })
  }

  test('small talk is marked idle so it does not pick the model', async () => {
    for (const t of ['hello', 'Hi Claude!', 'xin chào', 'cảm ơn nhé', 'ok', 'thanks']) {
      expect(classify(t).idle).toBe(true)
    }
    for (const t of ['hello, git la gi', 'ok fix the typo', 'hi']) {
      expect(classify(t).idle === true).toBe(t === 'hi')
    }
  })

  test('an empty prompt stays normal', async () => {
    expect(classify('   ').tier).toBe('normal')
  })

  test('every non-default verdict names its rule and source', async () => {
    expect(classify('refactor the auth module').reason).toMatch(/^refactor-or-migration \[.+\]$/)
    expect(classify('fix the typo').reason).toMatch(/^mechanical-edit \[.+\]$/)
  })
})
