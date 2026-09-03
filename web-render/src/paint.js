/**
 * Thin Canvas2D interpreter for draw ops (browser-only).
 * All decisions live in resolve.js; this file only executes absolute
 * numbers. Image/authored ops need async loading or the vendored runtime:
 * paint() throws structured errors for them until those land, so a missing
 * asset can never render as a silent blank.
 */

function paintOp(ctx, op, images) {
  switch (op.op) {
    case "background":
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = op.color;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
      return;
    case "rect":
      ctx.save();
      ctx.globalAlpha = op.alpha;
      ctx.fillStyle = op.color;
      ctx.fillRect(op.x, op.y, op.w, op.h);
      ctx.restore();
      return;
    case "circle":
      ctx.save();
      ctx.globalAlpha = op.alpha;
      ctx.strokeStyle = op.color;
      ctx.lineWidth = Math.max(2, op.r * 0.06);
      ctx.beginPath();
      ctx.arc(op.x, op.y, Math.max(0.1, op.r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    case "text":
      ctx.save();
      ctx.globalAlpha = op.alpha;
      ctx.fillStyle = op.color;
      ctx.font = `${op.size}px "${op.font}", sans-serif`;
      ctx.textAlign = op.align;
      ctx.textBaseline = "middle";
      ctx.fillText(op.str, op.x, op.y);
      ctx.restore();
      return;
    case "image": {
      const img = images ? images.get(op.ref) : undefined;
      if (!img) {
        const error = new Error(`image not loaded: ${op.ref}`);
        error.code = "image_not_loaded";
        throw error;
      }
      const cw = ctx.canvas.width;
      const ch = ctx.canvas.height;
      const scale = Math.max(cw / img.width, ch / img.height) * op.zoom;
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.save();
      ctx.globalAlpha = op.alpha;
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      ctx.restore();
      return;
    }
    case "blend": {
      const [under, over] = [op.under, op.over];
      paintOps(ctx, under, images);
      ctx.save();
      if (op.mode === "fade") {
        ctx.globalAlpha = op.mix;
        paintOps(ctx, over, images);
      } else {
        // slide: incoming travels leftwards over the frozen outgoing frame.
        ctx.translate((1 - op.mix) * ctx.canvas.width, 0);
        paintOps(ctx, over, images);
      }
      ctx.restore();
      return;
    }
    case "authored": {
      const error = new Error(`authored HyperFrames doc needs vendored runtime: ${op.doc_id}`);
      error.code = "authored_not_supported";
      throw error;
    }
    default: {
      const error = new Error(`unknown draw op: ${op && op.op}`);
      error.code = "unknown_op";
      throw error;
    }
  }
}

export function paintOps(ctx, ops, images) {
  for (const op of ops) paintOp(ctx, op, images);
}
