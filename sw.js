// يتيح عمل التطبيق دون اتصال بالإنترنت بعد أول فتح
const CACHE = "halaqa-v4";
const FILES = ["./", "index.html", "styles.css", "app.js", "data.js", "manifest.json", "icon.svg", "quran-data.js", "fonts/amiri-quran.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// الشبكة أولاً ثم النسخة المخزنة، حتى تصل التحديثات فور توفر الاتصال
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
