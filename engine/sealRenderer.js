/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V30.0 - RENDU VECTORIEL HAUTE DÉFINITION (HD)
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GlyphsLibrary = require('../library/glyphsLibrary');

const VISUAL_VERSION = 3;
const VISIBLE_GLYPH_COUNT = 24; // 24 glyphes sur anneau unique
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
        if (typeof bits === 'string' && new RegExp(`^[01]{${VISIBLE_GLYPH_COUNT}}$`).test(bits)) {
            return bits;
        }
        return null;
    },

    resolveProtocolGlyph(visibleIndex) {
        if (GlyphsLibrary && typeof GlyphsLibrary.resolveGlyph === 'function') {
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

        const outerRingRadius = outerRadius - 30;
        const singleRingRadius = outerRingRadius - 65; 

        return {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            singleRingRadius,
            outerRingRadius
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
        const angleOffset = Math.PI / count;

        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + angleOffset;
            positions.push({
                ring: 'single',
                angle,
                index: i
            });
        }

        return positions;
    },

    async renderSealToBuffer(payload = {}, options = {}) {
        // Rendu en 1080x1080 pour une netteté vectorielle parfaite
        const width = Math.max(1080, Math.round(options.width || 1080));
        const height = Math.max(1080, Math.round(options.height || 1080));

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Optimisations anti-aliasing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const GEOMETRY_COLOR = options.geometryColor || '#000000';
        const TEXT_PRIMARY_COLOR = options.textColor || '#000000';
        const TEXT_SECONDARY_COLOR = options.subTextColor || '#000000';
        const backgroundColor = options.backgroundColor || '#FFFFFF';

        const geometry = this.getGeometry(width, height);
        const {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            singleRingRadius,
            outerRingRadius
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
            'M10 120 520';

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
            rawItemNumber !== undefined && rawItemNumber !== null && !options.isMasterSeal && !payload.isMasterSeal
                ? String(rawItemNumber).split('/')[0].trim()
                : cleanSerialNum;

        const secureSignature = payload.secureSignature || payload.glyph_payload?.secureSignature || null;
        const suppliedVisualBits = payload.visualBits || payload.glyph_payload?.visualBits;

        const visualBits =
            this.normalizeVisualBits(suppliedVisualBits) ||
            this.deriveVisualBits(secureSignature || rawBatchName);

        // 1. Cercle extérieur noir net
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = Math.round(7 * scale);
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRingRadius + 20 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 2. Logo central
        const logoPath = options.logoPath || payload.logoPath || path.join(__dirname, '../assets/logo_anor_master.png');
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
                console.error('[sealRenderer] Erreur lors du chargement du logo :', error);
            }
        }

        // 3. Mires cardinales (Nord, Sud, Est, Ouest)
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

            ctx.lineWidth = Math.round(6 * scale);
            ctx.strokeRect(-20 * scale, -20 * scale, 40 * scale, 40 * scale);
            ctx.fillRect(-8 * scale, -8 * scale, 16 * scale, 16 * scale);

            ctx.restore();
        }
        ctx.restore();

        // 4. Rendu net des Glyphes
        const positions = this.getVisiblePositions();
        const glyphScale = 1.8 * scale; 
        const strokeWidth = Math.round(5.5 * scale);

        ctx.save();

        for (let visibleIndex = 0; visibleIndex < positions.length; visibleIndex++) {
            const pos = positions[visibleIndex];
            const radius = singleRingRadius;
            const angle = pos.angle;

            const px = centerX + radius * Math.cos(angle);
            const py = centerY + radius * Math.sin(angle);

            const glyphType = this.resolveProtocolGlyph(visibleIndex);
            const glyphDef = GlyphsLibrary.getGlyphDefinition(glyphType);
            const isFilled = visualBits[visibleIndex] === '1';

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);

            drawGlyphVectorHD(
                ctx,
                glyphType,
                glyphDef,
                isFilled,
                glyphScale,
                strokeWidth
            );

            ctx.restore();
        }
        ctx.restore();

        // 5. Textes (Lot et Série)
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = centerY + 185 * scale;

        ctx.font = `900 ${Math.round(48 * scale)}px sans-serif`;
        ctx.fillStyle = TEXT_PRIMARY_COLOR;
        ctx.fillText(`LOT ${batchText}`, centerX, textY - 18 * scale);

        ctx.font = `bold ${Math.round(28 * scale)}px sans-serif`;
        ctx.fillStyle = TEXT_SECONDARY_COLOR;
        ctx.fillText(`SÉRIE : ${itemText}`, centerX, textY + 22 * scale);

        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

/**
 * MOTEUR DU RENDU VECTORIEL DES 16 TYPES DE GLYPHES
 */
function drawGlyphVectorHD(ctx, type, def, isFilled, glyphScale = 1, strokeWidth = 4) {
    const w = (def.width || 18) * glyphScale;
    const h = (def.height || 18) * glyphScale;

    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';

    switch (type) {
        case 'square':
            if (isFilled) ctx.fillRect(-w / 2, -h / 2, w, h);
            else ctx.strokeRect(-w / 2, -h / 2, w, h);
            break;

        case 'square_dot':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.fillRect(-w / 6, -h / 6, w / 3, h / 3);
            break;

        case 'square_inner':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            if (isFilled) ctx.fillRect(-w / 3, -h / 3, (2 * w) / 3, (2 * h) / 3);
            else ctx.strokeRect(-w / 4, -h / 4, w / 2, h / 2);
            break;

        case 'rect':
            if (isFilled) ctx.fillRect(-w / 2, -h / 2, w, h);
            else ctx.strokeRect(-w / 2, -h / 2, w, h);
            break;

        case 'rect_half':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.fillRect(-w / 2, -h / 2, w / 2, h);
            break;

        case 'rect_double':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.strokeRect(-w / 4, -h / 4, w / 2, h / 2);
            break;

        case 'circle':
            ctx.beginPath();
            ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
            if (isFilled) ctx.fill();
            else ctx.stroke();
            break;

        case 'circle_dot':
            ctx.beginPath();
            ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, w / 5, 0, Math.PI * 2);
            ctx.fill();
            break;

        case 'diamond':
            ctx.save();
            ctx.rotate(Math.PI / 4);
            if (isFilled) ctx.fillRect(-w / 2, -h / 2, w, h);
            else ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.restore();
            break;

        case 'diamond_inner':
            ctx.save();
            ctx.rotate(Math.PI / 4);
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.fillRect(-w / 5, -h / 5, (2 * w) / 5, (2 * h) / 5);
            ctx.restore();
            break;

        case 'plus':
            ctx.beginPath();
            ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0);
            ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2);
            ctx.stroke();
            break;

        case 'plus_star':
            ctx.beginPath();
            ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0);
            ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2);
            ctx.stroke();
            ctx.fillRect(-w / 6, -h / 6, w / 3, h / 3);
            break;

        case 'triangle':
            ctx.beginPath();
            ctx.moveTo(0, -h / 2);
            ctx.lineTo(w / 2, h / 2);
            ctx.lineTo(-w / 2, h / 2);
            ctx.closePath();
            if (isFilled) ctx.fill();
            else ctx.stroke();
            break;

        case 'star':
            ctx.save();
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                ctx.lineTo(Math.cos(((18 + i * 72) * Math.PI) / 180) * (w / 2), -Math.sin(((18 + i * 72) * Math.PI) / 180) * (h / 2));
                ctx.lineTo(Math.cos(((54 + i * 72) * Math.PI) / 180) * (w / 4), -Math.sin(((54 + i * 72) * Math.PI) / 180) * (h / 4));
            }
            ctx.closePath();
            if (isFilled) ctx.fill();
            else ctx.stroke();
            ctx.restore();
            break;

        case 'hexagon':
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (i * Math.PI) / 3;
                const x = (w / 2) * Math.cos(angle);
                const y = (h / 2) * Math.sin(angle);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.closePath();
            if (isFilled) ctx.fill();
            else ctx.stroke();
            break;

        case 'bar':
            if (isFilled) ctx.fillRect(-w / 2, -h / 2, w, h);
            else ctx.strokeRect(-w / 2, -h / 2, w, h);
            break;

        default:
            ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
}

module.exports = sealRenderer;