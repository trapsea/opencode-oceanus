/**
 * hashline 编辑请求的类型定义。
 */

export interface ReplaceEdit {
  op: "replace"
  pos: string
  end?: string
  lines: string | string[]
}

export interface AppendEdit {
  op: "append"
  pos?: string
  lines: string | string[]
}

export interface PrependEdit {
  op: "prepend"
  pos?: string
  lines: string | string[]
}

export type HashlineEdit = ReplaceEdit | AppendEdit | PrependEdit

/** 用户/模型提供的宽松编辑格式（normalize 前的输入）。 */
export type HashlineToolOp = "replace" | "append" | "prepend"

export interface RawHashlineEdit {
  op?: HashlineToolOp
  pos?: string
  end?: string
  lines?: string | string[] | null
}

/** 行引用（解析后的结构）。 */
export interface LineRef {
  line: number
  hash: string
}
