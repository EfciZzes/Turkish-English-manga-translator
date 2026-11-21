# Manga Çevirici (İngilizce ↔ Türkçe)

Okuduğun sayfadaki manga görsellerinde yazıyı okur, çevirir ve baloncuğun üstüne yerleştirir. Chrome, Edge ve Brave'de çalışır.

Bu eklenti **senin kendi ücretsiz OCR anahtarınla** çalışır. Kota herkese ayrıdır, kimseyle paylaşılmaz.

---

## 1) Eklentiyi kur (5 dakika)

1. Bu zip dosyasını bir klasöre çıkar. **Klasörü sonra silme veya taşıma**, eklenti oradan çalışır.
2. Tarayıcının adres çubuğuna `chrome://extensions` yaz ve Enter'a bas. (Edge'de `edge://extensions`)
3. Sağ üstteki **Geliştirici modu** anahtarını aç.
4. Sol üstte çıkan **Paketlenmemiş öğe yükle** butonuna tıkla.
5. Zip'ten çıkardığın `manga-cevirici` klasörünü seç.
6. Eklenti listede görünür. Araç çubuğundaki bulmaca simgesinden eklentiyi sabitleyebilirsin.

## 2) Ücretsiz OCR anahtarı al (3 dakika)

OCR, resimdeki yazıyı okuyan servistir. Eklentinin çalışması için buna ihtiyacı var.

1. **ocr.space** sitesine git.
2. Sitedeki ücretsiz API (Free OCR API) bölümünden e-posta adresinle ücretsiz anahtar iste.
3. Gelen e-postadaki **API anahtarını** kopyala.

Ücretsiz planın bir aylık ve günlük istek sınırı vardır. Normal manga okumak için genelde yeter. Güncel sınırları ve kalan hakkını ocr.space'te hesabından görebilirsin.

## 3) Anahtarı eklentiye gir

1. Eklenti simgesine tıkla, **Ayarlar**'a bas. (Kurulumdan sonra bu sayfa kendiliğinden de açılır.)
2. **OCR.space API anahtarı** kutusuna anahtarı yapıştır.
3. **Kaydet**'e bas.

Anahtar sadece senin tarayıcında saklanır.

## 4) Kullan

1. Okumak istediğin manga sayfasını aç.
2. Eklenti simgesine tıkla ve **Sayfayı çevir**'e bas. (Kısayol: **Alt+T**)
3. Ekrandaki sayfalar çevrilir. Aşağı kaydırdıkça yenileri otomatik çevrilir.
4. Eski haline dönmek için **Orijinale dön**'e bas.

Tek bir görseli çevirmek için üzerine sağ tıklayıp **Bu görseli çevir**'i seçebilirsin.

> İlk kez kurduysan ve manga sayfası zaten açıksa, sayfayı bir kez yenile (F5).

## Sözlük (çevrilmemesi gereken isimler)

Mangalardaki karakter ve yer adları çevrilmesin diye sözlük kullanılır.

- Eklenti simgesindeki **Çevrilmesin diye sözlüğe ekle** kutusuna kelimeyi yaz: `Konoha`
- Sabit bir çeviri istersen: `Hidden Leaf = Gizli Yaprak`
- Her manga için ayrı sözlük açmak istersen **Yeni seri adı**'na mangayı yaz ve **Ekle**'ye bas. O sitede hangi sözlüğün kullanılacağı hatırlanır.
- Türkçe ekler otomatik uyarlanır: Konoha'ya, Sasuke'nin, Naruto'dan gibi.

Sözlüğe eklediğin kelimeler **sonraki** çevirilerde geçerli olur. Açık sayfada denemek için **Orijinale dön** deyip tekrar **Sayfayı çevir**'e bas.

## OCR hakkı nasıl harcanır, nasıl az harcanır

- Eklenti simgesine tıklayınca altta **bugünkü ve bu ayki OCR isteği** sayısı görünür.
- Her yeni sayfa 1 istek harcar (çok uzun görseller birden fazla). Daha önce okunan sayfa önbellekten gelir ve harcamaz.
- Hızlı kaydırırken üstünden geçtiğin sayfalar çevrilmez, sadece durup baktıkların çevrilir.
- Reklam, logo ve küçük resimler atlanır.
- Servisin sınırı dolarsa eklenti otomatik çeviriyi durdurur ve nedenini yazar, boşuna istek atmaz.

## Sorun giderme

- **"OCR API anahtarı girilmemiş" diyor:** Adım 3'ü yap.
- **"OCR.space hatası" veya "kota" benzeri bir hata:** Günlük/aylık hakkın dolmuş olabilir. Biraz bekle veya ocr.space hesabından kalan hakkına bak.
- **Hiçbir şey olmuyor:** Sayfayı yenile (F5) ve tekrar dene.
- **Bazı yazılar yanlış okunuyor:** El yazısı tarzı veya çok küçük yazılarda OCR hata yapabilir. Bu servisin sınırıdır.
- **Çeviri çok yavaş veya hata veriyor:** Çeviri için Google Translate'in herkese açık ucu kullanılıyor. Yoğunlukta geçici yavaşlayabilir, biraz sonra tekrar dene.
- **Chrome her açılışta "geliştirici modundaki eklentileri kapat" uyarısı veriyor:** Eklenti mağazadan değil klasörden yüklendiği için bu normal. Uyarıyı kapatıp devam edebilirsin.
- **Eklenti kendiliğinden kapandı:** `chrome://extensions` sayfasından açık olduğundan emin ol ve klasörü silmediğinden/taşımadığından emin ol.

## İzin hakkında

Eklenti kurulurken "tüm sitelerdeki verileri okuma ve değiştirme" izni ister. Bunun nedeni, manga sitelerinin görsel sunucularından resmi indirebilmesi ve çevrilmiş halini sayfaya koyabilmesidir. Resimler OCR servisine, okunan metin çeviri servisine gönderilir. Başka hiçbir yere veri gönderilmez.

## Bilinen sınırlar

- Yalnızca sayfadaki `<img>` görselleri çevrilir. Yazıyı canvas ile çizen veya CSS arka planı kullanan okuyucularda çalışmaz.
- Sayfa yenilenince çeviri yeniden yapılır ama okunan yazı önbellekte durduğu için OCR hakkından harcamaz.
- Büyük ses efektleri (BOOM gibi) varsayılan olarak çevrilmez. Ayarlar'dan değiştirilebilir.
