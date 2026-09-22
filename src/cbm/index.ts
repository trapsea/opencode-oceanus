/**
 * codebase-memory-mcp（CBM）wave 3 wiring 入口。
 *
 * 对外暴露 MCP 注册器与相关的本地 server 常量/构造辅助，供 `src/index.ts`
 * 接线（CBM-13）与测试直接消费。本模块只做转发，不包含业务逻辑。
 */
export {
  buildLocalConfig,
  buildMcpEnvironment,
  CBM_MANAGED_MARKER_ENV,
  CBM_MANAGED_MARKER_VALUE,
  isCbmManaged,
  isSameManagedLocalConfig,
  MCP_ENV_WHITELIST,
  MCP_SERVER_NAME,
  registerCbmMcp,
  removeCbmMcp,
  resolveExpectedBinaryPath,
} from './mcp';
export type { McpRegisterOptions, McpRegistrationResult } from './mcp';
