/**
 * Hashline 常量定义。
 *
 * 行 hash 被编码为两个 nibble 字符。nibble 字典故意使用
 * 非十六进制字母（避免与十进制行号混淆），保证形如 `12#QW`。
 */
export const NIBBLE_STR = "ZPMQVRWSNKTXJBYH"

/** 256 个两字符 hash 编码，索引 = 字节值（0-255）。 */
export const HASHLINE_DICT: string[] = Array.from({ length: 256 }, (_, i) => {
  const high = i >>> 4
  const low = i & 0x0f
  return `${NIBBLE_STR[high]}${NIBBLE_STR[low]}`
})

/** 行引用：`{行号}#{两字符 hash}`。 */
export const HASHLINE_REF_PATTERN = /^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})$/

/** 输出行：`{行号}#{两字符 hash}|{内容}`。 */
export const HASHLINE_OUTPUT_PATTERN = /^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})\|(.*)$/
