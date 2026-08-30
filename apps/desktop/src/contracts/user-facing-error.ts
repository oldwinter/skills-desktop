/**
 * Maps stable renderer / about error codes to short user-facing copy.
 * Raw `message` stays available for details/devtools — never as the primary banner sentence.
 */
export type UserFacingErrorLike = {
  readonly code: string;
  readonly message: string;
};

export const GITHUB_SOURCE_OWNER_REPOSITORY_COPY =
  "GitHub source must be owner/repository.";

const USER_FACING_BY_CODE: Readonly<Record<string, string>> = {
  cancelled: "操作已取消。需要时请重试。",
  check_failed: "更新检查未能完成。请稍后重试。",
  cli_incompatible: "skills CLI 版本不兼容。请升级 CLI 后刷新。",
  confirmation_expired: "确认已过期。请重新发起操作。",
  confirmation_invalid: "确认无效。请重新发起操作。",
  conflicting_inventory_entry: "库存条目冲突。请核对后重试。",
  duplicate_inventory_entry: "存在重复库存条目。请清理后重试。",
  host_key_changed: "主机密钥已变更。主机身份复核未在 V1 开放。",
  host_trust_invalid: "主机信任无效。主机身份复核未在 V1 开放。",
  host_trust_required: "需要确认主机身份，但主机身份复核未在 V1 开放。",
  internal_error: "内部错误。请重试；若持续失败请导出诊断。",
  invalid_intent: "操作意图无效。请检查后重试。",
  invalid_inventory: "库存数据无效。请刷新后重试。",
  invalid_request: "请求无效。请检查输入后重试。",
  inventory_too_large: "库存过大，无法完整加载。请缩小范围后重试。",
  mutation_conflict: "变更冲突。请刷新库存后重试。",
  mutation_ineligible: "当前无法执行变更。请先满足前置条件。",
  persist_failed: "保存失败。请重试；若持续失败请检查磁盘权限。",
  process_failed: "本地进程执行失败。请刷新后重试。",
  reconciliation_required: "需要先完成 reconciliation。",
  reconciliation_wait: "正在等待 reconciliation。请稍后再试。",
  remote_protocol_mismatch: "远程协议不匹配。请检查远端运行时版本。",
  remote_protocol_violation: "远程协议异常。请检查远端连接后重试。",
  remote_runtime_unavailable: "远程运行时不可用。请检查远端环境后重试。",
  review_expired: "复核已过期。请重新打开复核。",
  review_invalid: "复核无效。请重新打开复核。",
  ssh_config_invalid: "SSH 配置无效。V1 仅支持 Local Target。",
  stale_inventory: "库存证据已过期。请先刷新。",
  target_not_found: "找不到该 Target。请返回 Targets 列表确认。",
  target_unavailable: "Target 当前不可用。请检查后重试。",
  transport_failed: "连接失败。请检查网络或 Target 后重试。",
  transport_lost: "连接已断开。请重连后刷新。",
  transport_unavailable: "连接不可用。请检查 Target 后重试。",
  unauthorized: "无权限执行该操作。",
  unsupported_schema: "数据格式不受支持。请升级应用后重试。",
};

export const USER_FACING_ERROR_FALLBACK =
  "操作未能完成。请重试；若持续失败可导出诊断查看详情。";

export function userFacingErrorMessage(
  error: UserFacingErrorLike | null | undefined,
): string {
  if (error === null || error === undefined) {
    return USER_FACING_ERROR_FALLBACK;
  }
  if (error.message === GITHUB_SOURCE_OWNER_REPOSITORY_COPY) {
    return GITHUB_SOURCE_OWNER_REPOSITORY_COPY;
  }
  return USER_FACING_BY_CODE[error.code] ?? USER_FACING_ERROR_FALLBACK;
}
