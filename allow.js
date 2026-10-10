// Hosts the embedded webview may navigate to (Instagram + Facebook / Meta account login).
const allowed = (url) => {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && /(^|\.)(instagram|facebook|meta)\.com$/.test(hostname)
  } catch {
    return false
  }
}

module.exports = allowed

if (require.main === module) {
  const assert = require('assert')
  assert(allowed('https://www.instagram.com/direct/inbox/'))
  assert(allowed('https://m.facebook.com/login'))
  assert(allowed('https://accounts.meta.com/'))
  assert(!allowed('https://notmeta.com/'))
  assert(!allowed('https://instagram.com.evil.io/'))
  assert(!allowed('https://evilinstagram.com/'))
  assert(!allowed('http://www.instagram.com/'))
  assert(!allowed('javascript:alert(1)'))
  assert(!allowed('not a url'))
  console.log('ok')
}
