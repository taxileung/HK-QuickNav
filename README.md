# MyMapHK 導航轉換器

這是一個手機優先的極簡靜態網頁工具，可貼上 MyMapHK 座標，或直接輸入香港地點搜尋：

- `輸入地點`：每打一個字即時使用香港政府 Location Search API 搜尋地址、屋苑、設施或地名
- `貼上`：讀取 MyMapHK 複製的文字並自動轉換
- `Google 地圖`：直接打開 Google Maps 導航
- `高德地圖`：直接打開高德導航
- `Waze`：直接打開 Waze 導航

## 功能

- 支援 MyMapHK 的三種 `WGS84` 文字格式
- 支援香港政府地點搜尋，並用地政總署坐標轉換 API 將 `HK1980` 坐標轉成 `WGS84`
- 自動轉換成十進位座標，例如 `22.39242,114.30784`
- iPhone 會優先嘗試打開 Google Maps App，失敗時回退到網頁版導航
- Android 會優先嘗試打開 Google Maps App，失敗時回退到網頁版導航
- iPhone / Android 都會優先嘗試打開高德地圖 App，失敗時回退到高德網頁導航
- iPhone / Android 都會使用 Waze 官方 Deep Link，裝有 Waze 時會開 App，否則開 Waze 網頁

## 使用方式

1. 在手機打開你已部署的 HTTPS 網站頁面
2. 直接輸入地點，等搜尋結果出現後選擇正確結果
3. 或在 MyMapHK 複製位置文字，回到網頁按「貼上」
4. 再按 Google 地圖、高德或 Waze 按鈕開始導航

## 部署

這個專案不需要建置流程，直接把整個資料夾放到任何靜態網站服務即可，例如 GitHub Pages、Netlify、Cloudflare Pages。若要讓「貼上」按鈕更穩定地讀取剪貼簿，實際手機使用建議走 HTTPS。
