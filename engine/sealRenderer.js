/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V40.0 - FIX ESPACEMENT ORBITAL & DISTRIBUTION UNIFORME
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GlyphsLibrary = require('../library/glyphsLibrary');

const VISUAL_VERSION = 3;
const VISIBLE_GLYPH_COUNT = 28;
const CANONICAL_OUTER_RADIUS = 500;

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
        if (
            typeof bits === 'string' &&
            new RegExp(`^[01]{${VISIBLE_GLYPH_COUNT}}$`).test(bits)
        ) {
            return bits;
        }
        return null;
    },

    resolveProtocolGlyph(visibleIndex) {
        if (
            GlyphsLibrary &&
            typeof GlyphsLibrary.resolveGlyph === 'function'
        ) {
            return GlyphsLibrary.resolveGlyph(visibleIndex);
        }
        return 'square';
    },

    getGeometry(width, height) {
        const outerRadius = Math.min(width, height) / 2 - 20;
        const centerX = width / 2;
        const centerY = height / 2;
        
        const logoSize = Math.round(width * 0.42); 
        const logoRadius = logoSize / 2;

        const outerRingRadius = outerRadius - 10;
        const glyphOrbitRadius = outerRingRadius - 48;

        return {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            outerRingRadius,
            glyphOrbitRadius
        };
    },

    getFinderAngles() {
        return [
            -Math.PI / 2, // Nord
            0,            // Est
            Math.PI / 2,  // Sud
            Math.PI       // Ouest
        ];
    },

    getVisiblePositions() {
        const positions = [];
        const count = VISIBLE_GLYPH_COUNT;
        const finderAngles = this.getFinderAngles();
        const safetyMargin = (12 * Math.PI) / 180;

        let validAngles = [];
        const totalSteps = 360;

        for (let i = 0; i < totalSteps; i++) {
            const angle = (i / totalSteps) * Math.PI * 2;
            let isNearFinder = false;

            for (const fAngle of finderAngles) {
                let diff = Math.abs(angle - fAngle);
                while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
                if (diff < safetyMargin) {
                    isNearFinder = true;
                    break;
                }
            }

            if (!isNearFinder) {
                validAngles.push(angle);
            }
        }

        const step = validAngles.length / count;
        for (let i = 0; i < count; i++) {
            const index = Math.min(Math.floor(i * step), validAngles.length - 1);
            positions.push({
                ring: 'single',
                angle: validAngles[index],
                index: i
            });
        }

        return positions;
    },

    async renderSealToBuffer(payload = {}, options = {}) {
        const width = Math.max(1080, Math.round(options.width || 1080));
        const height = Math.max(1080, Math.round(options.height || 1080));

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const GEOMETRY_COLOR = options.geometryColor || '#000000';
        const TEXT_PRIMARY_COLOR = options.textColor || '#000000';
        const TEXT_SECONDARY_COLOR = options.subTextColor || '#111111';
        const backgroundColor = options.backgroundColor || '#FFFFFF';

        const geometry = this.getGeometry(width, height);
        const {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            outerRingRadius,
            glyphOrbitRadius
        } = geometry;

        const scale = outerRadius / CANONICAL_OUTER_RADIUS;

        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);

        const rawBatchName =
            payload.lot ||
            payload.batchNumber ||
            payload.batchName ||
            payload.productName ||
            payload.name ||
            options.batchNumber ||
            options.lot ||
            'P65 854 751';

        const normalizedBatchName = String(rawBatchName).trim().toUpperCase();
        const batchText = normalizedBatchName.replace(/^LOT\s*/i, '');

        const rawMasterLabel = options.masterSerialLabel || '000000';
        const cleanSerialNum = rawMasterLabel.split('/')[0].trim();

        const rawItemNumber =
            payload.itemNumber ??
            options.itemNumber ??
            payload.serialNumber ??
            options.serial;

        const itemText =
            rawItemNumber !== undefined &&
            rawItemNumber !== null &&
            !options.isMasterSeal &&
            !payload.isMasterSeal
                ? String(rawItemNumber).split('/')[0].trim()
                : cleanSerialNum;

        const secureSignature =
            payload.secureSignature ||
            payload.glyph_payload?.secureSignature ||
            null;

        const suppliedVisualBits =
            payload.visualBits ||
            payload.glyph_payload?.visualBits;

        const visualBits =
            this.normalizeVisualBits(suppliedVisualBits) ||
            this.deriveVisualBits(secureSignature || rawBatchName);

        if (!visualBits || visualBits.length !== VISIBLE_GLYPH_COUNT) {
            throw new Error(`[sealRenderer] Matrice visuelle invalide : ${VISIBLE_GLYPH_COUNT} bits requis.`);
        }

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = Math.round(6 * scale);
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRingRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        const logoPath =
            options.logoPath ||
            payload.logoPath ||
            path.join(__dirname, '../assets/logo_anor_master.png');

        const logoCenterY = centerY - 70 * scale;

        if (fs.existsSync(logoPath)) {
            try {
                const img = await loadImage(logoPath);
                ctx.drawImage(
                    img,
                    centerX - logoRadius,
                    logoCenterY - logoRadius,
                    logoSize,
                    logoSize
                );
            } catch (error) {
                console.error('[sealRenderer] Erreur chargement logo :', error);
            }
        }

        const finderAngles = this.getFinderAngles();

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;

        for (let i = 0; i < finderAngles.length; i++) {
            const angle = finderAngles[i];
            const px = centerX + outerRingRadius * Math.cos(angle);
            const py = centerY + outerRingRadius * Math.sin(angle);

            ctx.save();
            ctx.translate(px, py);

            ctx.lineWidth = Math.round(5 * scale);
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(-18 * scale, -18 * scale, 36 * scale, 36 * scale);

            ctx.fillStyle = GEOMETRY_COLOR;
            ctx.strokeRect(-15 * scale, -15 * scale, 30 * scale, 30 * scale);
            ctx.fillRect(-6 * scale, -6 * scale, 12 * scale, 12 * scale);

            ctx.restore();
        }
        ctx.restore();

        const positions = this.getVisiblePositions();
        const glyphWidth = 18 * scale;
        const glyphLength = 48 * scale;
        const strokeWidth = Math.round(4 * scale);

        ctx.save();

        for (let visibleIndex = 0; visibleIndex < positions.length; visibleIndex++) {
            const pos = positions[visibleIndex];
            const angle = pos.angle;

            const px = centerX + glyphOrbitRadius * Math.cos(angle);
            const py = centerY + glyphOrbitRadius * Math.sin(angle);

            const glyphType = this.resolveProtocolGlyph(visibleIndex);
            const isFilled = visualBits[visibleIndex] === '1';

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle + Math.PI / 2);

            ctx.shadowColor = 'rgba(0, 0, 0, 0.40)';
            ctx.shadowBlur = 5 * scale;
            ctx.shadowOffsetX = 2 * scale;
            ctx.shadowOffsetY = 2 * scale;

            drawGlyphStretchedTowardCenter2D(
                ctx,
                glyphType,
                isFilled,
                glyphWidth,
                glyphLength,
                strokeWidth
            );

            ctx.restore();
        }
        ctx.restore();

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = centerY + 175 * scale;

        ctx.font = `900 ${Math.round(48 * scale)}px sans-serif`;
        ctx.fillStyle = TEXT_PRIMARY_COLOR;
        ctx.fillText(`${batchText}`, centerX, textY - 15 * scale);

        ctx.font = `900 ${Math.round(44 * scale)}px sans-serif`;
        ctx.fillStyle = TEXT_SECONDARY_COLOR;
        ctx.fillText(`${itemText}`, centerX, textY + 35 * scale);

        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

function drawGlyphStretchedTowardCenter2D(ctx, type, isFilled, w, h, strokeWidth) {
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = isFilled ? '#000000' : '#FFFFFF';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';

    switch (type) {
        case 'square':
        case 'bar':
        case 'rect':
            if (isFilled) {
                ctx.fillRect(-w / 2, -h / 2, w, h);
                ctx.fillStyle = '#222222';
                ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
            } else {
                ctx.strokeRect(-w / 2, -h / 2, w, h);
            }
            break;

        case 'square_dot':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.fillStyle = '#000000';
            ctx.fillRect(-w / 4, -h / 4, w / 2, h / 2);
            break;

        case 'square_inner':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            if (isFilled) {
                ctx.fillStyle = '#000000';
                ctx.fillRect(-w / 3, -h / 3, (2 * w) / 3, (2 * h) / 3);
            } else {
                ctx.strokeRect(-w / 4, -h / 4, w / 2, h / 2);
            }
            break;

        case 'rect_half':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.fillStyle = '#000000';
            ctx.fillRect(-w / 2, -h / 2, w / 2, h);
            break;

        case 'rect_double':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.strokeRect(-w / 4, -h / 4, w / 2, h / 2);
            break;

        case 'circle':
            ctx.beginPath();
            ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
            if (isFilled) {
                ctx.fillStyle = '#000000';
                ctx.fill();
            }
            ctx.stroke();
            break;

        case 'circle_dot':
            ctx.beginPath();
            ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(0, 0, w / 4, h / 4, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#000000';
            ctx.fill();
            break;

        case 'diamond':
            ctx.beginPath();
            ctx.moveTo(0, -h / 2);
            ctx.lineTo(w / 2, 0);
            ctx.lineTo(0, h / 2);
            ctx.lineTo(-w / 2, 0);
            ctx.closePath();
            if (isFilled) {
                ctx.fillStyle = '#000000';
                ctx.fill();
            }
            ctx.stroke();
            break;

        case 'diamond_inner':
            ctx.beginPath();
            ctx.moveTo(0, -h / 2);
            ctx.lineTo(w / 2, 0);
            ctx.lineTo(0, h / 2);
            ctx.lineTo(-w / 2, 0);
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = '#000000';
            ctx.fillRect(-w / 5, -h / 5, (2 * w) / 5, h * 0.4);
            break;

        case 'plus':
            ctx.beginPath();
            ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0);
            ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2);
            ctx.stroke();
            break;

        default:
            if (isFilled) {
                ctx.fillRect(-w / 2, -h / 2, w, h);
            } else {
                ctx.strokeRect(-w / 2, -h / 2, w, h);
            }
    }
}

module.exports = sealRenderer;