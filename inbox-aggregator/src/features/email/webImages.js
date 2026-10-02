// Whether an email's HTML shows any images from the web (in img tags or its
// styles), for the "Images from the web are hidden" notice.
export function hasWebImages(html) {
  return Boolean(html) && /<img[^>]+src\s*=\s*["']?https?:|url\(\s*["']?https?:|background\s*=\s*["']?https?:/i.test(html);
}
