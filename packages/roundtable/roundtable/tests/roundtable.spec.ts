import { describe, expect, it } from 'vitest'
import { RoundtableEngine, RoundtableError } from '../src/index.ts'

describe('RoundtableEngine', () => {
  it('服务键是 roundtable', () => {
    expect(RoundtableEngine.prototype).toBeTruthy()
  })
  it('RoundtableError 携带 code', () => {
    const e = new RoundtableError('bad', 'ROSTER_INVALID')
    expect(e.code).toBe('ROSTER_INVALID')
    expect(e.name).toBe('RoundtableError')
  })
})
