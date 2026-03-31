// ==========================================
// CULOchan業務Pro — 画像処理ユーティリティ v1.0
// このファイルはスキャナー画像の切り出しに使う低レベル画像処理を担当する
//
// 提供する機能:
//   - グレースケール変換
//   - 白背景でのレシート領域検出
//   - モルフォロジー処理（膨張・収縮・クロージング・オープニング）
//   - 連結成分ラベリング（2パス法）
//   - 領域抽出・切り出し
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
    // モルフォロジー処理
    // ==========================================

    // v1.0 - 膨張（Dilation）
    function morphDilate(bin, w, h, r) {
        var res = new Uint8Array(w * h);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var found = false;
                for (var dy = -r; dy <= r && !found; dy++) {
                    for (var dx = -r; dx <= r && !found; dx++) {
                        var ny = y + dy;
                        var nx = x + dx;
                        if (ny >= 0 && ny < h && nx >= 0 && nx < w && bin[ny * w + nx]) {
                            found = true;
                        }
                    }
                }
                res[y * w + x] = found ? 1 : 0;
            }
        }
        return res;
    }

    // v1.0 - 収縮（Erosion）
    function morphErode(bin, w, h, r) {
        var res = new Uint8Array(w * h);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var allSet = true;
                for (var dy = -r; dy <= r && allSet; dy++) {
                    for (var dx = -r; dx <= r && allSet; dx++) {
                        var ny = y + dy;
                        var nx = x + dx;
                        if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
                            if (!bin[ny * w + nx]) allSet = false;
                        } else {
                            allSet = false;
                        }
                    }
                }
                res[y * w + x] = allSet ? 1 : 0;
            }
        }
        return res;
    }

    // v1.0 - クロージング（膨張→収縮）：穴埋め
    function morphClose(bin, w, h, r) {
        return morphErode(morphDilate(bin, w, h, r), w, h, r);
    }

    // v1.0 - オープニング（収縮→膨張）：ノイズ除去
    function morphOpen(bin, w, h, r) {
        return morphDilate(morphErode(bin, w, h, r), w, h, r);
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

        // 第1パス
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

        // 第2パス
        for (var i = 0; i < labelMap.length; i++) {
            if (labelMap[i] > 0) {
                labelMap[i] = findRoot(equivalences, labelMap[i]);
            }
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

    // ==========================================
    // 白背景レシート検出（スキャナー特化）
    // ==========================================

    // v1.0 - 白背景上のレシート領域検出
    // スキャナーの白背景（240+）に対して、レシートのエッジを検出する
    // 戻り値: [{ x, y, w, h, area }, ...]
    function detectRegionsOnWhiteBg(gray, imgW, imgH) {
        // ステップ1: 処理用にリサイズ（速度のため）
        var scale = 1;
        var procW = imgW;
        var procH = imgH;
        if (imgW > 1500) {
            scale = 1500 / imgW;
            procW = Math.round(imgW * scale);
            procH = Math.round(imgH * scale);
            gray = resizeGray(gray, imgW, imgH, procW, procH);
        }

        // ステップ2: 白背景の閾値で二値化（210: 白背景のやや下を閾値に）
        var threshold = 210;
        var bin = new Uint8Array(procW * procH);
        for (var i = 0; i < bin.length; i++) {
            bin[i] = (gray[i] < threshold) ? 1 : 0;
        }

        // ステップ3: モルフォロジー処理
        bin = morphClose(bin, procW, procH, 5);   // ノイズ除去
        bin = morphOpen(bin, procW, procH, 3);     // 小さなゴミ除去
        bin = morphClose(bin, procW, procH, 15);   // レシート内の隙間を埋める

        // ステップ4: 連結成分ラベリング
        var labeled = labelComponents(bin, procW, procH);
        var regions = extractRegions(labeled.labelMap, procW, procH);

        // ステップ5: 小さすぎる領域を除外（画像全体の2%未満）
        var minArea = procW * procH * 0.02;
        regions = regions.filter(function(r) { return r.area >= minArea; });

        // ステップ6: 元の解像度に座標を戻す
        if (scale !== 1) {
            regions = regions.map(function(r) {
                return {
                    x: Math.round(r.x / scale),
                    y: Math.round(r.y / scale),
                    w: Math.round(r.w / scale),
                    h: Math.round(r.h / scale),
                    area: r.area / (scale * scale)
                };
            });
        }

        // ステップ7: パディング追加（余白を持たせて切り出し）
        var pad = 10;
        regions = regions.map(function(r) {
            return {
                x: Math.max(0, r.x - pad),
                y: Math.max(0, r.y - pad),
                w: Math.min(imgW - r.x + pad, r.w + pad * 2),
                h: Math.min(imgH - r.y + pad, r.h + pad * 2),
                area: r.area
            };
        });

        // ステップ8: 面積でソート（大きい順）、最大8枚まで
        regions.sort(function(a, b) { return b.area - a.area; });
        return regions.slice(0, 8);
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
        morphDilate: morphDilate,
        morphErode: morphErode,
        morphClose: morphClose,
        morphOpen: morphOpen,
        labelComponents: labelComponents,
        extractRegions: extractRegions,
        detectRegionsOnWhiteBg: detectRegionsOnWhiteBg,
        cropRegion: cropRegion
    };
})();
