(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GyomuScanner = factory();
})(globalThis, function () {
  'use strict';

  const MIN = 1e-4;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  function sanitizeBox(box) {
    if (!box || ['x','y','w','h'].some(k => typeof box[k] !== 'number' || !Number.isFinite(box[k]))) {
      throw new TypeError('Crop coordinates must be finite numbers');
    }
    const x = clamp(box.x, 0, 1 - MIN);
    const y = clamp(box.y, 0, 1 - MIN);
    return {
      x, y,
      w: Math.min(1-x, Math.max(MIN, box.x + box.w - x)),
      h: Math.min(1-y, Math.max(MIN, box.y + box.h - y))
    };
  }

  function pixelGray(data, i) {
    const alpha = data[i+3] / 255;
    return Math.round(255 * (1-alpha) + alpha * (data[i]*.2126 + data[i+1]*.7152 + data[i+2]*.0722));
  }

  function quantile(hist, size, fraction) {
    let k = Math.floor((size-1)*fraction);
    for (let i = 0; i < hist.length; i++) {
      k -= hist[i];
      if (k < 0) return i;
    }
    return 255;
  }

  function extent(projection, cutoff) {
    let start = -1, last = -1, active = 0;
    for (let i=0; i<projection.length; i++) {
      if (projection[i] < cutoff) continue;
      if (start === -1) start = i;
      last = i;
      active++;
    }
    if (start === -1 || active / (last - start + 1) < .9) return null;
    return [start, last + 1];
  }

  function analyzeCell(gray, width, x0, y0, x1, y1) {
    const w = x1-x0, h = y1-y0;
    if (w < 22 || h < 22) return null;

    // The cell perimeter estimates the page behind the receipt. A colored or
    // faint-gray paper body may stand out; isolated ink lines alone must not.
    const hist = new Uint32Array(256);
    const border = Math.max(1, Math.floor(Math.min(w,h) / 55));
    let count = 0;
    for (let yy=0; yy<h; yy++) {
      for (let xx=0; xx<w; xx++) {
        if (xx>=border && xx<w-border && yy>=border && yy<h-border) continue;
        hist[gray[(yy+y0)*width+xx+x0]]++;
        count++;
      }
    }
    const base = quantile(hist, count, .5);
    const noise = quantile(hist,count,.85)-quantile(hist,count,.15);
    const threshold = Math.max(4, Math.ceil(noise * 1.35 + 2));
    if (threshold > 26) return null;
    const byX = new Uint32Array(w), byY = new Uint32Array(h), mask = new Uint8Array(w*h);
    let total = 0;
    for (let yy=0; yy<h; yy++) {
      for (let xx=0; xx<w; xx++) {
        if (Math.abs(gray[(yy+y0)*width+xx+x0]-base) < threshold) continue;
        byX[xx]++;
        byY[yy]++;
        mask[yy*w+xx] = 1;
        total++;
      }
    }
    const ex = extent(byX, Math.max(4,.21*h));
    const ey = extent(byY, Math.max(4,.21*w));
    if (!ex || !ey) return null;
    let [left,right] = ex, [top,bottom] = ey;
    const bw = right-left, bh = bottom-top;
    // An ambiguous or seam-touching candidate keeps the whole cell editable.
    if (bw < .26*w || bh < .26*h ||
        Math.min(left,w-right) < border || Math.min(top,h-bottom) < border) return null;
    let inside = 0;
    for (let yy=top; yy<bottom; yy++) {
      for (let xx=left; xx<right; xx++) inside += mask[yy*w+xx];
    }
    const density = inside / (bw*bh);
    if (density < .61 || (total-inside) / Math.max(1,total) > .11) return null;
    const px = Math.max(2,Math.ceil(.024*w)), py = Math.max(2,Math.ceil(.024*h));
    left = Math.max(0,left-px); right = Math.min(w,right+px);
    top = Math.max(0,top-py); bottom = Math.min(h,bottom+py);
    return {left:left+x0,right:right+x0,top:top+y0,bottom:bottom+y0,
      method:'detected',confidence:Math.round(Math.min(.95,.42 + .49*density)*100)/100};
  }

  function detectImageData(imageData, {columns=3,rows=2} = {}) {
    const {data,width,height} = imageData;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 ||
        !data || data.length !== width*height*4) throw new TypeError('Expected RGBA image data');
    if (![columns,rows].every(n => Number.isInteger(n) && n>=1 && n<=12)) {
      throw new RangeError('Invalid grid size');
    }
    const gray = new Uint8Array(width*height);
    for (let i=0;i<gray.length;i++) gray[i] = pixelGray(data,4*i);
    const boxes = [];
    for (let row=0;row<rows;row++) {
      for (let column=0;column<columns;column++) {
        const x0 = Math.round(column*width/columns), x1 = Math.round((column+1)*width/columns);
        const y0 = Math.round(row*height/rows), y1 = Math.round((row+1)*height/rows);
        const hit = analyzeCell(gray,width,x0,y0,x1,y1);
        boxes.push(hit ? {
          x: hit.left/width, y: hit.top/height,
          w: (hit.right-hit.left)/width, h: (hit.bottom-hit.top)/height,
          method:hit.method, confidence:hit.confidence
        } : {x:column/columns,y:row/rows,w:1/columns,h:1/rows,method:'grid',confidence:0});
      }
    }
    return {boxes,width,height};
  }

  function imageSize(image) {
    if (!image) throw new TypeError('Expected a decoded image or canvas');
    const width = image.naturalWidth ?? image.width, height = image.naturalHeight ?? image.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1) {
      throw new TypeError('Expected a decoded image or canvas');
    }
    return {width,height};
  }

  function canvasOf(width,height, readFrequently = false) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', {willReadFrequently:readFrequently});
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0,0,width,height);
    return {canvas,ctx};
  }

  function detectImage(image, {columns=3,rows=2} = {}) {
    const {width,height} = imageSize(image);
    const scale = Math.min(1,950 / Math.max(width,height));
    const w = Math.max(1,Math.round(width*scale)), h = Math.max(1,Math.round(height*scale));
    const {ctx} = canvasOf(w,h,true);
    ctx.drawImage(image,0,0,w,h);
    const {boxes} = detectImageData(ctx.getImageData(0,0,w,h),{columns,rows});
    return {boxes,width,height};
  }

  function cropImage(image, box, {maxSide=1600} = {}) {
    const {width,height} = imageSize(image);
    const b = sanitizeBox(box);
    if (!Number.isFinite(maxSide) || maxSide < 1 || maxSide > 8192) throw new RangeError('Invalid maxSide');
    const x = Math.min(width-1,Math.floor(b.x*width)), y = Math.min(height-1,Math.floor(b.y*height));
    const w = Math.min(width-x,Math.max(1,Math.ceil((b.x+b.w)*width)-x));
    const h = Math.min(height-y,Math.max(1,Math.ceil((b.y+b.h)*height)-y));
    const scale = Math.min(1,Math.floor(maxSide) / Math.max(w,h));
    const outW = Math.max(1,Math.round(w*scale)), outH = Math.max(1,Math.round(h*scale));
    const {canvas,ctx} = canvasOf(outW,outH);
    ctx.drawImage(image,x,y,w,h,0,0,outW,outH);
    return canvas;
  }

  return {detectImage,detectImageData,cropImage,sanitizeBox};
});
