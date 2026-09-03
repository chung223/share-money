/** 用 LINE 官方 URL scheme 打開「分享給好友」畫面（手機版 LINE），文字先填好。不需要任何 LINE 開發者設定。 */
export function lineShareUrl(text: string) {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`
}
export function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}
