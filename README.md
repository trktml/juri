# Canlı Sunum Oylama Sistemi

6 grubun sunum yaptığı etkinlikler için geliştirilmiş, gerçek zamanlı (WebSocket) jüri oylama ve canlı televizyon/projeksiyon skor takip uygulaması.

## Özellikler

- **4 Değerlendirme Kriteri (1–5 Puan):**
  1. Bilgilerin yeterliliği
  2. Sunum becerisi
  3. Hazırlanma emeği
  4. Malzeme kalitesi
- **3 Özel Ekran:**
  - `/juri`: Jürilerin telefon veya tabletlerinden kolayca ad girip 6 gruptan birini seçerek puanlama yapabileceği mobil uyumlu oylama ekranı. Aynı jüri aynı grubun puanını istediği zaman güncelleyebilir.
  - `/tv`: Televizyon ve projeksiyon cihazları için yüksek kontrastlı, uzaktan okunabilir canlı skor tablosu. Yeni oy geldiğinde kart üzerinde anlık parlama animasyonu ve bildirim şeridi gösterir. **6 Grup Tablo**, **Sahne Odağı (Spotlight)** ve **Tam Ekran** modlarını destekler.
  - `/yonetim`: 6 grubun isimlerini ve sunum konularını düzenleme, şu an sahnede olan grubu seçme, jüri × grup puan matrisini denetleme, hatalı oyu silme, örnek demo verisi yükleme ve oyları sıfırlama paneli.
- **Kalıcı Depolama (`data/oylama.sqlite`):** Tüm grup isimleri, ayarlar ve oylar Bun'ın yerleşik `bun:sqlite` veritabanında saklanır. Veritabanı yolu `DATABASE_PATH` veya `DB_PATH` ortam değişkeni ile değiştirilebilir.

## Kurulum ve Çalıştırma

Proje **Bun** çalışma zamanı ile ek bağımlılık gerektirmeden çalışır.

```bash
cd sunum-oylamasi
bun start
```

Sunucu varsayılan olarak `3000` portundan başlar (farklı bir port için `PORT=4000 bun start` kullanabilirsiniz; port 3000 doluysa otomatik olarak uygun bir port seçer).

Sunucu açıldığında terminalde yerel ağ (`http://192.168.x.x:3000`) adresini de yazdırır:
- **TV Ekranı:** `http://localhost:3000/tv`
- **Jüri Oylaması:** `http://<YEREL-IP>:3000/juri`
- **Yönetim Paneli:** `http://localhost:3000/yonetim`

## Testleri Çalıştırma

```bash
bun test
```

## Dokploy ile Yayınlama (Nixpacks)

GitHub kaynağı olarak `main` dalını ve **Build Type → Nixpacks** seçeneğini kullanın. **Publish Directory** alanını boş bırakın. Depodaki `nixpacks.toml` Bun kurulumunu yapar ve uygulamayı konteyner içinde `0.0.0.0:3000` adresinde başlatır.

- **Domains → Container Port:** `3000` (veya tanımladığınız `PORT` değeri).
- **Advanced → Mounts:** Hedefi `/app/data` olan bir **Volume Mount** ekleyin. Varsayılan SQLite veritabanı (`data/oylama.sqlite`) burada tutulur ve yeniden dağıtımlarda korunur.

## Dosya Yapısı

- `server.ts`: HTTP API, WebSocket canlı yayın (`/ws`) ve SQLite (`data/oylama.sqlite`) veritabanı katmanı.
- `public/index.html`: Jüri, TV ve Yönetim görünümlerini içeren tek sayfa arayüzü.
- `server.test.ts`: API doğrulama, puan hesaplama ve WebSocket gerçek zamanlı yayın testleri.
- `nixpacks.toml`: Dokploy / Nixpacks Bun çalışma zamanı yapılandırması.
