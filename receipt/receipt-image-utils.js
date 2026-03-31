// ==========================================
// CULOchan業務Pro — 画像処理ユーティリティ v1.1
// このファイルはスキャナー画像の切り出しに使う低レベル画像処理を担当する
//
// v1.1変更: 白背景レシート検出を「エッジ検出方式」に変更
//   - 閾値二値化方式だとレシートの白紙と背景の白が区別できなかった
//   - エッジ（輝度変化）を検出→膨張→連結成分で領域検出する方式に変更
//   - 実際のRICOH P C301SF スキャン画像（300dpi JPEG）で検証済み
//
// 依存: なし（純粋な画像処理関数群）
// 利用元: receipt-scanner.js
// ==========================================

const ImageUtils = (() => {

    // v1.0 - 画像読み込み
    function loadImage(dataUrl) {
        return new Promise(function(resolve, reject) {
            var img = new Image();
            img.onload = function() { resolve(img); };
            img.onerror = function() { reject(new Error('画像の読み込みに失敗')); };
            img.src = dataUrl;
        });
    }

    // v1.0 - グレースケール変換（人間の視覚に近い重み付け）
    function toGrayscale(data, w, h) {
        var gray = new Uint8Array(w * h);
        for (var i = 0; i < w * h; i++) {
            var idx = i * 4;
            gray[i] = Math.round(data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
        }
        return gray;
    }

    // v1.0 - グレースケール画像のリサイズ（最近傍法）
    function resizeGray(gray, srcW, srcH, dstW, dstH) {
        var result = new Uint8Array(dstW * dstH);
        for (var y = 0; y < dstH; y++) {
            for (var x = 0; x < dstW; x++) {
                var sx = Math.floor(x * srcW / dstW);
                var sy = Math.floor(y * srcH / dstH);
                result[y * dstW + x] = gray[sy * srcW + sx];
            }
        }
        return result;
    }

    // ==========================================
    // v1.1 エッジ検出方式によるレシート領域検出
    // ==========================================

    // v1.1 - メイン検出関数（エッジ検出方式）
    // スキャナーの白背景上のレシートを検出する
    // レシート紙自体も白いため、輝度差（エッジ）で境界を捉える
    // 戻り値: [{ x, y, w, h, area }, ...]
    function detectRegionsOnWhiteBg(gray, imgW, imgH) {
        // ステップ1: 処理速度のためダウンサンプリング（1/4）
        var scale = 4;
        var procW = Math.floor(imgW / scale);
        var procH = Math.floor(imgH / scale);
        var small = resizeGray(gray, imgW, imgH, procW, procH);

        // ステップ2: エッジ検出（水平・垂直方向の輝度差分）
        var edge = new Float32Array(procW * procH);
        for (var y = 1; y < procH; y++) {
            for (var x = 1; x < procW; x++) {
                var idx = y * procW + x;
                // 垂直方向のエッジ
                var dv = Math.abs(small[idx] - small[(y - 1) * procW + x]);
                // 水平方向のエッジ
                var dh = Math.abs(small[idx] - small[y * procW + (x - 1)]);
                edge[idx] = Math.max(dv, dh);
            }
        }

        // ステップ3: エッジを二値化（閾値30: 文字やレシート境界のエッジを捉える）
        var edgeBin = new Uint8Array(procW * procH);
        var edgeThreshold = 30;
        for (var i = 0; i < edge.length; i++) {
            edgeBin[i] = (edge[i] > edgeThreshold) ? 1 : 0;
        }

        // ステップ4: ガウシアンブラー的な膨張（エッジ間の隙間を埋める）
        // 大きな半径でぼかして、レシート内部のエッジを1つの塊にする
        var blurred = boxBlur(edgeBin, procW, procH, 12);
        // ぼかし後に再二値化（閾値を低くして広く拾う）
        var filled = new Uint8Array(procW * procH);
        for (var i = 0; i < blurred.length; i++) {
            filled[i] = (blurred[i] > 0.08) ? 1 : 0;
        }

        // ステップ5: 連結成分ラベリングで領域抽出
        var labeled = labelComponents(filled, procW, procH);
        var regions = extractRegions(labeled.labelMap, procW, procH);

        // ステップ6: 小さすぎる領域を除外（画像全体の0.5%未満）
        var minArea = procW * procH * 0.005;
        regions = regions.filter(function(r) { return r.area >= minArea; });

        // ステップ7: 元の解像度に座標を戻す
        regions = regions.map(function(r) {
            return {
                x: r.x * scale,
                y: r.y * scale,
                w: r.w * scale,
                h: r.h * scale,
                area: r.area * scale * scale
            };
        });

        // ステップ8: パディング追加（余白を持たせて切り出し）
        var pad = 15;
        regions = regions.map(function(r) {
            return {
                x: Math.max(0, r.x - pad),
                y: Math.max(0, r.y - pad),
                w: Math.min(imgW - Math.max(0, r.x - pad), r.w + pad * 2),
                h: Math.min(imgH - Math.max(0, r.y - pad), r.h + pad * 2),
                area: r.area
            };
        });

        // ステップ9: 面積でソート（大きい順）、最大8枚まで
        regions.sort(function(a, b) { return b.area - a.area; });
        return regions.slice(0, 8);
    }

    // v1.1 - ボックスブラー（高速近似ガウシアン）
    // 二値画像を0.0〜1.0のfloatに変換してぼかす
    function boxBlur(bin, w, h, radius) {
        var src = new Float32Array(w * h);
        for (var i = 0; i < bin.length; i++) src[i] = bin[i];

        var dst = new Float32Array(w * h);
        // 水平パス
        for (var y = 0; y < h; y++) {
            var sum = 0;
            // 初期ウィンドウ
            for (var x = 0; x < Math.min(radius, w); x++) sum += src[y * w + x];
            for (var x = 0; x < w; x++) {
                // 右端を追加
                if (x + radius < w) sum += src[y * w + x + radius];
                // 左端を除去
                if (x - radius - 1 >= 0) sum -= src[y * w + x - radius - 1];
                var count = Math.min(x + radius, w - 1) - Math.max(x - radius, 0) + 1;
                dst[y * w + x] = sum / count;
            }
        }
        // 垂直パス
        var result = new Float32Array(w * h);
        for (var x = 0; x < w; x++) {
            var sum = 0;
            for (var y = 0; y < Math.min(radius, h); y++) sum += dst[y * w + x];
            for (var y = 0; y < h; y++) {
                if (y + radius < h) sum += dst[(y + radius) * w + x];
                if (y - radius - 1 >= 0) sum -= dst[(y - radius - 1) * w + x];
                var count = Math.min(y + radius, h - 1) - Math.max(y - radius, 0) + 1;
                result[y * w + x] = sum / count;
            }
        }
        return result;
    }

    // ==========================================
    // 連結成分ラベリング（2パス法）
    // ==========================================

    // Union-Findのルート探索
    function findRoot(eq, label) {
        while (eq[label] !== undefined) label = eq[label];
        return label;
    }

    // v1.0 - 連結成分ラベリング
    function labelComponents(bin, w, h) {
        var labelMap = new Int32Array(w * h);
        var nextLabel = 1;
        var equivalences = {};

        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var idx = y * w + x;
                if (!bin[idx]) { labelMap[idx] = 0; continue; }

                var above = (y > 0) ? labelMap[(y - 1) * w + x] : 0;
                var left = (x > 0) ? labelMap[y * w + (x - 1)] : 0;

                if (!above && !left) {
                    labelMap[idx] = nextLabel++;
                } else if (above && !left) {
                    labelMap[idx] = above;
                } else if (!above && left) {
                    labelMap[idx] = left;
                } else {
                    var mn = Math.min(above, left);
                    var mx = Math.max(above, left);
                    labelMap[idx] = mn;
                    if (mn !== mx) {
                        var rootMx = findRoot(equivalences, mx);
                        var rootMn = findRoot(equivalences, mn);
                        if (rootMx !== rootMn) {
                            equivalences[Math.max(rootMx, rootMn)] = Math.min(rootMx, rootMn);
                        }
                    }
                }
            }
        }

        for (var i = 0; i < labelMap.length; i++) {
            if (labelMap[i] > 0) labelMap[i] = findRoot(equivalences, labelMap[i]);
        }

        return { labelMap: labelMap, labelCount: nextLabel - 1 };
    }

    // v1.0 - ラベルマップから領域（矩形）を抽出
    function extractRegions(labelMap, w, h) {
        var regionData = {};
        for (var i = 0; i < labelMap.length; i++) {
            var label = labelMap[i];
            if (!label) continue;
            var x = i % w;
            var y = Math.floor(i / w);
            if (!regionData[label]) {
                regionData[label] = { minX: x, minY: y, maxX: x, maxY: y, px: 0 };
            }
            var rd = regionData[label];
            if (x < rd.minX) rd.minX = x;
            if (x > rd.maxX) rd.maxX = x;
            if (y < rd.minY) rd.minY = y;
            if (y > rd.maxY) rd.maxY = y;
            rd.px++;
        }

        var regions = [];
        var keys = Object.keys(regionData);
        for (var k = 0; k < keys.length; k++) {
            var r = regionData[keys[k]];
            regions.push({
                x: r.minX, y: r.minY,
                w: r.maxX - r.minX + 1,
                h: r.maxY - r.minY + 1,
                area: r.px
            });
        }
        return regions;
    }

    // v1.0 - 領域を画像として切り出す（品質劣化なし）
    function cropRegion(sourceCanvas, region) {
        var cropCanvas = document.createElement('canvas');
        cropCanvas.width = region.w;
        cropCanvas.height = region.h;
        var ctx = cropCanvas.getContext('2d');
        ctx.drawImage(
            sourceCanvas,
            region.x, region.y, region.w, region.h,
            0, 0, region.w, region.h
        );
        return cropCanvas.toDataURL('image/jpeg', 0.95);
    }

    return {
        loadImage: loadImage,
        toGrayscale: toGrayscale,
        resizeGray: resizeGray,
        detectRegionsOnWhiteBg: detectRegionsOnWhiteBg,
        cropRegion: cropRegion
    };
})();
