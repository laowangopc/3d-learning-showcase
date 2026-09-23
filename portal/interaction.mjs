// Keep repeated keyboard actions immediate; pointer-only feedback is decorative.
export function scrollBehavior({keyboard = false, reducedMotion = false} = {}) {
  return keyboard || reducedMotion ? 'instant' : 'smooth';
}

export function isSearchShortcut(event, editing = false, dialogOpen = false) {
  return event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey &&
    !event.isComposing && !editing && !dialogOpen;
}

export function requestError(status) {
  if (status === 401) return '请先登录，再继续操作。';
  if (status === 403) return '当前账号无法进行此操作，请联系资源上传者或管理员。';
  if (status === 404) return '这件资源暂时无法访问，请选择其他资源或刷新页面。';
  if (status === 409) return '内容已被更新，请刷新后再保存；先复制保留你的草稿。';
  if (status === 413) return '文件太大，请压缩到 64 MB 以内再上传。';
  if (status === 429) return '操作较频繁，请稍后重试。';
  if (status === 400 || status === 422) return '操作未完成，请检查填写内容及文件格式后重试。';
  return '暂时无法连接服务，请稍后重试。';
}

export function licenseLabel(license) {
  if (license === 'unknown') return '待核对';
  if (license === 'permission') return '按来源条款使用';
  return license;
}
