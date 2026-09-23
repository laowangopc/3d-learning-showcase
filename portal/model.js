const scene = new URL(location.href).searchParams.get('scene');
const error = document.getElementById('error');
if (!/^lr-[a-f0-9-]{36}$/.test(scene || '')) {
  error.textContent = '请选择一个有效的模型。';
} else {
  fetch(`/learn/api/resources/${encodeURIComponent(scene)}`).then(async response => {
    if (!response.ok) throw new Error('模型不存在或无权访问，请登录后重试。');
    const resource = await response.json();
    if (resource.kind !== 'model') throw new Error('这个资源不是三维模型。');
    const script = document.createElement('script');
    script.src = '/dist/js/voyager-explorer.js';
    script.onerror = () => { error.textContent = '三维观察器未加载，请刷新重试。'; };
    script.onload = () => {
      error.remove();
      const explorer = document.createElement('voyager-explorer');
      explorer.setAttribute('resourceroot', '/dist/');
      explorer.setAttribute('dracoroot', '/dist/js/draco/');
      explorer.setAttribute('root', `/scenes/${encodeURIComponent(scene)}/`);
      explorer.setAttribute('document', 'scene.svx.json');
      document.body.append(explorer);
      // Voyager renders inside a shadow root: page-level CSS cannot reach it.
      // Hide only its duplicate heading, retaining controls and annotation titles.
      explorer.updateComplete.then(() => {
        const style = document.createElement('style');
        style.textContent = '.sv-chrome-header .sv-main-title{display:none!important}';
        (explorer.shadowRoot || explorer).append(style);
      });
    };
    document.head.append(script);
  }).catch(e => { error.textContent = e.message || '模型未读取完成，请刷新重试。'; });
}
