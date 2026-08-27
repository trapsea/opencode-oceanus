import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { verifyDist } from './verify-dist-auto-update'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'verify-dist-auto-update-'))
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    main: 'dist/index.js', types: 'dist/index.d.ts',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, './tui': { types: './dist/tui.d.ts', import: './dist/tui.js' } },
  }))
  for (const file of ['index.js', 'index.d.ts', 'tui.js', 'tui.d.ts']) await writeFile(join(root, 'dist', file), file === 'index.js' ? 'registerAutoUpdate auto_update' : '')
  return root
}

test('校验有效的 dist 发布产物', async () => {
  expect(verifyDist(await fixture())).toEqual([])
})

test('报告缺失声明和自动更新 bundle', async () => {
  const root = await fixture()
  await unlink(join(root, 'dist', 'tui.d.ts'))
  await writeFile(join(root, 'dist', 'index.js'), '')
  const failures = verifyDist(root)
  expect(failures.some((failure) => failure.includes('dist/tui.d.ts'))).toBe(true)
  expect(failures.some((failure) => failure.includes('自动更新'))).toBe(true)
})
