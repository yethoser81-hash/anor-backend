/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V32.0 - RENDU VECTORIEL 2D PROFFESIONNEL (HAUTE VISIBILITÉ)
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
        const outerRadius = Math.min(width, height) / 2 - 15;
        const centerX = width / 2;
        const centerY = height / 2;
        
        // Logo agrandi massivement pour remplir le centre
        const logoSize = Math.round(width * 0.48); 
        const logoRadius = logoSize / 2;

        const outerRingRadius = outerRadius - 20;
        const singleRingRadius = outerRingRadius - 75; 

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
            singleRingRadius,
            outerRingRadius
        } = geometry;

        const scale = outerRadius / CANONICAL_OUTER_RADIUS;

        // Fond
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
            'M52 450 210';

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

        // 1. Double Cercle Extérieur avec effet de profondeur 2D
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
        ctx.shadowBlur = 10 * scale;
        ctx.shadowOffsetX = 3 * scale;
        ctx.shadowOffsetY = 3 * scale;

        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = Math.round(10 * scale);
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRingRadius + 22 * scale, 0, Math.PI * 2);
        ctx.stroke();

        ctx.lineWidth = Math.round(4 * scale);
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRingRadius + 12 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 2. Logo Central Agrandit
        const logoPath = options.logoPath || payload.logoPath || path.join(__dirname, '../assets/logo_anor_master.png');
        const logoCenterY = centerY - 80 * scale;

        if (fs.existsSync(logoPath)) {
            try {
                const img = await loadImage(logoPath);

                ctx.save();
                ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
                ctx.shadowBlur = 8 * scale;
                ctx.shadowOffsetY = 4 * scale;

                ctx.drawImage(
                    img,
                    centerX - logoRadius,
                    logoCenterY - logoRadius,
                    logoSize,
                    logoSize
                );
                ctx.restore();
            } catch (error) {
                console.error('[sealRenderer] Erreur chargement logo :', error);
            }
        }

        // 3. Mires Cardinales 2D
        const finderAngles = this.getFinderAngles();

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 6 * scale;
        ctx.shadowOffsetX = 2 * scale;
        ctx.shadowOffsetY = 2 * scale;

        for (let i = 0; i < finderAngles.length; i++) {
            const angle = finderAngles[i];
            const px = centerX + outerRingRadius * Math.cos(angle);
            const py = centerY + outerRingRadius * Math.sin(angle);

            ctx.save();
            ctx.translate(px, py);

            ctx.lineWidth = Math.round(8 * scale);
            ctx.strokeRect(-24 * scale, -24 * scale, 48 * scale, 48 * scale);
            ctx.fillRect(-10 * scale, -10 * scale, 20 * scale, 20 * scale);

            ctx.restore();
        }
        ctx.restore();

        // 4. Glyphes AGRANDIES & EFFET 2D (Ombrage + Relief)
        const positions = this.getVisiblePositions();
        const glyphScale = 3.0 * scale; // Glyphes nettement plus grandes
        const strokeWidth = Math.round(8.5 * scale);

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

            // Application du rendu 2D (Effet de relief et d'ombre)
            ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
            ctx.shadowBlur = 5 * scale;
            ctx.shadowOffsetX = 2 * scale;
            ctx.shadowOffsetY = 3 * scale;

            drawGlyphVectorHD2D(
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

        // 5. Textes MASSIVEMENT AGRANDIS (Lot et Série)
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = centerY + 180 * scale;

        // Numéro de Lot (Très grand et très gras)
        ctx.font = `900 ${Math.round(58 * scale)}px sans-serif`;
        ctx.fillStyle = TEXT_PRIMARY_COLOR;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
        ctx.shadowBlur = 4 * scale;
        ctx.fillText(`${batchText}`, centerX, textY - 25 * scale);

        // Numéro de Série AGRANDI (Passé de 28px à 50px pour une parfaite visibilité à 2cm)
        ctx.font = `900 ${Math.round(50 * scale)}px sans-serif`;
        ctx.fillStyle = TEXT_SECONDARY_COLOR;
        ctx.fillText(`${itemText}`, centerX, textY + 38 * scale);

        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

/**
 * RENDU 2D VECTORIEL AVEC RELIEF ET EFFET D'OMBRE
 */
function drawGlyphVectorHD2D(ctx, type, def, isFilled, glyphScale = 1, strokeWidth = 4) {
    // Élongation de la taille des glyphes (+25% sur la hauteur h pour allonger)
    const w = (def.width || 18) * glyphScale;
    const h = (def.height || 18) * glyphScale * 1.25;

    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = isFilled ? '#000000' : '#FFFFFF';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';

    switch (type) {
        case 'square':
            if (isFilled) {
                ctx.fillRect(-w / 2, -h / 2, w, h);
            } else {
                ctx.fillRect(-w / 2, -h / 2, w, h);
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

        case 'rect':
            ctx.fillRect(-w / 2, -h / 2, w, h);
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            break;

        case 'rect_half':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.fillStyle = '#000000';
            ctx.fillRect(-w / 2, -h / 2, w / 2, h);
            break;

        case 'circle':
            ctx.beginPath();
            ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
            if (isFilled) {
                ctx.fillStyle = '#000000';
                ctx.fill();
            }
            ctx.stroke();
            break;

        case 'circle_dot':
            ctx.beginPath();
            ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, w / 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#000000';
            ctx.fill();
            break;

        case 'diamond':
            ctx.save();
            ctx.rotate(Math.PI / 4);
            if (isFilled) ctx.fillStyle = '#000000';
            ctx.fillRect(-w / 2, -h / 2, w, h);
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.restore();
            break;

        case 'plus':
            ctx.beginPath();
            ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0);
            ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2);
            ctx.stroke();
            break;

        case 'triangle':
            ctx.beginPath();
            ctx.moveTo(0, -h / 2);
            ctx.lineTo(w / 2, h / 2);
            ctx.lineTo(-w / 2, h / 2);
            ctx.closePath();
            if (isFilled) ctx.fillStyle = '#000000';
            ctx.fill();
            ctx.stroke();
            break;

        case 'star':
            ctx.save();
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                ctx.lineTo(Math.cos(((18 + i * 72) * Math.PI) / 180) * (w / 2), -Math.sin(((18 + i * 72) * Math.PI) / 180) * (h / 2));
                ctx.lineTo(Math.cos(((54 + i * 72) * Math.PI) / 180) * (w / 4), -Math.sin(((54 + i * 72) * Math.PI) / 180) * (h / 4));
            }
            ctx.closePath();
            if (isFilled) ctx.fillStyle = '#000000';
            ctx.fill();
            ctx.stroke();
            ctx.restore();
            break;

        default:
            ctx.fillRect(-w / 2, -h / 2, w, h);
            ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
}

module.exports = sealRenderer;