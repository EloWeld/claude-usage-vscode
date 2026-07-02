import * as assert from 'assert'
import * as os from 'os'
import * as path from 'path'
import { commandChainsBackToOurTap, tapFilePathIn } from '../../services/statusline-install'
import { STATUSLINE_TAP_FILE } from '../../services/statusline'

const q = (p: string): string => `"/opt/homebrew/bin/node" "${p}"`
const managerTap = path.join(os.homedir(), '.claude', '.claude-manager', 'statusline-tap.js')
const managerDir = path.dirname(managerTap)

suite('Statusline Cycle Guard Test Suite', () => {
  test('tapFilePathIn extracts a quoted tap path', () => {
    assert.strictEqual(tapFilePathIn(q(managerTap)), managerTap)
  })

  test('tapFilePathIn extracts a bare tap path', () => {
    assert.strictEqual(tapFilePathIn(`node ${managerTap}`), managerTap)
  })

  test('tapFilePathIn returns null for a non-tap command', () => {
    assert.strictEqual(tapFilePathIn('my-statusline --flag'), null)
  })

  test('empty command does not chain back', () => {
    assert.strictEqual(commandChainsBackToOurTap('', () => ''), false)
  })

  test('plain command does not chain back', () => {
    assert.strictEqual(commandChainsBackToOurTap('echo hi', () => ''), false)
  })

  test('our own tap chains back immediately', () => {
    assert.strictEqual(commandChainsBackToOurTap(q(STATUSLINE_TAP_FILE), () => ''), true)
  })

  test('foreign tap whose inner points back at us is a cycle', () => {
    const reader = (dir: string): string => (dir === managerDir ? q(STATUSLINE_TAP_FILE) : '')
    assert.strictEqual(commandChainsBackToOurTap(q(managerTap), reader), true)
  })

  test('foreign tap wrapping a real command is healthy', () => {
    const reader = (dir: string): string => (dir === managerDir ? 'my-statusline' : '')
    assert.strictEqual(commandChainsBackToOurTap(q(managerTap), reader), false)
  })

  test('self-referential foreign chain terminates instead of hanging', () => {
    const reader = (dir: string): string => (dir === managerDir ? q(managerTap) : '')
    assert.strictEqual(commandChainsBackToOurTap(q(managerTap), reader), true)
  })
})
