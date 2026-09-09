/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V6.2 - MODE QR CODE MONOCHROME (NOIR / BLANC)
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GlyphsLibrary = require('../library/glyphsLibrary');

const VISUAL_VERSION = 1;
const VISIBLE_GLYPH_COUNT = 51;
const CANONICAL_OUTER_RADIUS = 375;

const sealRenderer = {

    deriveVisualBits(seed) {
        const digest = crypto
            .createHash('sha256')
            .update(`ANOR_VISUAL_V${VISUAL_VERSION}:${String(seed)}`)
            .digest();

        let bits = '';
        for (const byte of digest) {
            bits += byte.toString(2).padStart(8, '0');
        }
        return bits.slice(0, VISIBLE_GLYPH_COUNT);
    },

    normalizeVisualBits(bits) {
        if (typeof bits === 'string' && /^[01]{51}$/.test(bits)) {
            return bits;
        }
        return null;
    },

    resolveProtocolGlyph(visibleIndex) {
        if (GlyphsLibrary && typeof GlyphsLibrary.resolveGlyph === 'function') {
            return GlyphsLibrary.resolveGlyph(visibleIndex);
        }
        const types = ['square', 'rect', 'circle', 'diamond', 'plus'];
        return types[visibleIndex % types.length];
    },

    getGeometry(width, height) {
        const outerRadius = Math.min(width, height) / 2 - 25;
        const centerX = width / 2;
        const centerY = height / 2;
        const logoSize = 220;
        const logoRadius = logoSize / 2;

        const innerRingRadius = logoRadius + 45;
        const outerRingRadius = outerRadius - 30;
        const midRingRadius = (innerRingRadius + outerRingRadius) / 2;

        return {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            innerRingRadius,
            midRingRadius,
            outerRingRadius
        };
    },

    getFinderAngles() {
        return [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    },

    isOuterFinderCollision(angle) {
        for (const targetAngle of this.getFinderAngles()) {
            let diff = Math.abs(angle - targetAngle);
            if (diff > Math.PI) diff = (Math.PI * 2) - diff;
            if (diff < 0.31) return true;
        }
        return false;
    },

    getVisiblePositions() {
        const positions = [];
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const deg = angle * 180 / Math.PI;
            if (deg >= 20 && deg <= 160) continue;
            positions.push({ ring: 'inner', ringPosition: i, theoreticalCount: 12 });
        }
        for (let i = 0; i < 24; i++) {
            positions.push({ ring: 'middle', ringPosition: i, theoreticalCount: 24 });
        }
        for (let i = 0; i < 32; i++) {
            const angle = (i / 32) * Math.PI * 2;
            if (this.isOuterFinderCollision(angle)) continue;
            positions.push({ ring: 'outer', ringPosition: i, theoreticalCount: 32 });
        }
        return positions;
    },

    async renderSealToBuffer(payload = {}, options = {}) {
        const width = Math.max(400, Math.round(options.width || 800));
        const height = Math.max(400, Math.round(options.height || 800));

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Contraste maximal : Fond blanc pur, éléments en noir pur
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        const GEOMETRY_COLOR = '#000000';
        const geometry = this.getGeometry(width, height);
        const { centerX, centerY, outerRadius, logoSize, logoRadius, innerRingRadius, midRingRadius, outerRingRadius } = geometry;

        const rawBatchName = payload.lot || payload.batchNumber || options.batchNumber || 'LOT DEFAUT';
        const normalizedBatchName = String(rawBatchName).trim().toUpperCase();
        const batchText = normalizedBatchName.startsWith('LOT') ? normalizedBatchName : `LOT ${normalizedBatchName}`;
        const itemText = payload.itemNumber ? `N° ${payload.itemNumber}` : 'DM / 000 000';

        const secureSignature = payload.secureSignature || payload.glyph_payload?.secureSignature || null;
        const suppliedVisualBits = payload.visualBits || payload.glyph_payload?.visualBits;
        const visualBits = this.normalizeVisualBits(suppliedVisualBits) || this.deriveVisualBits(secureSignature || rawBatchName);

        // Cercle extérieur rigide
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Logo central
        const logoPath = options.logoPath || payload.logoPath || path.join(__dirname, '../assets/logo_anor_master.png');
        if (fs.existsSync(logoPath)) {
            try {
                const img = await loadImage(logoPath);
                ctx.drawImage(img, centerX - logoRadius, centerY - logoRadius - 35, logoSize, logoSize);
            } catch (error) {
                console.error('[sealRenderer] Erreur logo:', error);
            }
        }

        // Glyphes monochromes stricts (Noir / Blanc pur)
        const positions = this.getVisiblePositions();
        const glyphScale = 1.20;
        const strokeWidth = 5;
        const rings = { inner: innerRingRadius, middle: midRingRadius, outer: outerRingRadius };

        for (let visibleIndex = 0; visibleIndex < positions.length; visibleIndex++) {
            const position = positions[visibleIndex];
            const radius = rings[position.ring];
            const angle = (position.ringPosition / position.theoreticalCount) * Math.PI * 2;

            const px = centerX + radius * Math.cos(angle);
            const py = centerY + radius * Math.sin(angle);

            const glyphType = this.resolveProtocolGlyph(visibleIndex);
            const glyphDef = GlyphsLibrary.getGlyphDefinition(glyphType);
            const isFilled = visualBits[visibleIndex] === '1';

            // Noir si plein, Blanc masqué/contour si vide (Contraste binaire net)
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);

            ctx.strokeStyle = '#000000';
            ctx.fillStyle = '#000000';
            ctx.lineWidth = strokeWidth;

            drawMonochromeGlyph(ctx, glyphType, glyphDef, isFilled, glyphScale, strokeWidth);
            ctx.restore();
        }

        // Mires cardinales de type QR Code
        ctx.save();
        const finderSize = 44;
        const finderCore = 18;
        ctx.strokeStyle = '#000000';
        ctx.fillStyle = '#000000';
        ctx.lineWidth = 5;

        for (const targetAngle of this.getFinderAngles()) {
            const px = centerX + outerRingRadius * Math.cos(targetAngle);
            const py = centerY + outerRingRadius * Math.sin(targetAngle);
            ctx.save();
            ctx.translate(px, py);
            ctx.strokeRect(-finderSize / 2, -finderSize / 2, finderSize, finderSize);
            ctx.fillRect(-finderCore / 2, -finderCore / 2, finderCore, finderCore);
            ctx.restore();
        }
        ctx.restore();

        // Texte net
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const scale = outerRadius / CANONICAL_OUTER_RADIUS;
        const textY = centerY + 115 * scale;

        ctx.font = `bold ${Math.round(28 * scale)}px sans-serif`;
        ctx.fillStyle = '#000000';
        ctx.fillText(batchText, centerX, textY - 18 * scale);

        ctx.font = `bold ${Math.round(26 * scale)}px monospace`;
        ctx.fillStyle = '#333333';
        ctx.fillText(itemText, centerX, textY + 22 * scale);
        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

function drawMonochromeGlyph(ctx, type, def, isFilled, glyphScale, strokeWidth) {
    const width = def.width * glyphScale;
    const height = def.height * glyphScale;

    if (isFilled) {
        ctx.fillRect(-width / 2, -height / 2, width, height);
    } else {
        // Effacement en blanc pour détacher le fond vide du noir environnant
        ctx.save();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(-width / 2 - 2, -height / 2 - 2, width + 4, height + 4);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = strokeWidth;
        ctx.strokeRect(-width / 2, -height / 2, width, height);
        ctx.restore();
    }
}

module.exports = sealRenderer;