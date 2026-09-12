/**
 * agent-browser 前端渲染验证能力层（browser-verify）。
 *
 * - detect：三级探测（PATH → 配置 binaryPath → npm global）+ 可选 doctor。
 * - install：确认门 fail-closed 的两段安装（npm → Chrome for Testing）。
 *
 * 消费方：setup 'browser' 阶段（fail-open 探测与 autoInstall 安装）；
 * 运行时 agent 按 browser-verify skill 文案用 shell 执行 CLI，不经本模块。
 */
export {
  detectAgentBrowser,
  type AgentBrowserDetectDeps,
  type AgentBrowserDetectResult,
  type AgentBrowserSource,
} from './detect';
export {
  installAgentBrowser,
  BrowserInstallError,
  type AgentBrowserInstallDeps,
  type AgentBrowserInstallOptions,
  type AgentBrowserInstallResult,
  type BrowserInstallErrorCode,
} from './install';
