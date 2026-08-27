import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function verifyDist(root = process.cwd()): string[] {
  const failures: string[] = []
  let pkg: any
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch {
    return ['无法读取 package.json']
  }

  if (pkg.main !== 'dist/index.js') failures.push('package.json main 未指向 dist/index.js')
  if (pkg.types !== 'dist/index.d.ts') failures.push('package.json types 未指向 dist/index.d.ts')
  const rootExport = pkg.exports?.['.']
  const tuiExport = pkg.exports?.['./tui']
  if (rootExport?.import !== './dist/index.js' || rootExport?.types !== './dist/index.d.ts') failures.push('exports[.] 未完整指向 dist')
  if (tuiExport?.import !== './dist/tui.js' || tuiExport?.types !== './dist/tui.d.ts') failures.push('exports[./tui] 未完整指向 dist')

  for (const file of ['dist/index.js', 'dist/index.d.ts', 'dist/tui.js', 'dist/tui.d.ts']) {
    try { readFileSync(join(root, file)) } catch { failures.push(`缺少发布产物 ${file}`) }
  }
  try {
    const bundle = readFileSync(join(root, 'dist/index.js'), 'utf8')
    if (!/registerAutoUpdate|auto_update|autoUpdate/.test(bundle)) failures.push('dist/index.js 未包含自动更新模块')
  } catch {
    // 缺失文件已在上面报告。
  }
  return failures
}

if (import.meta.main) {
  const failures = verifyDist()
  if (failures.length) {
    console.error('dist 自动更新发布产物校验失败:')
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
  console.log('[verify-dist-auto-update] OK')
}
