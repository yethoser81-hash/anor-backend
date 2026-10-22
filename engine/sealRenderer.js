/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V28.0 - ALIGNEMENT PARFAIT, ZÉRO CHEVAUCHEMENT (28 BITS)
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GlyphsLibrary = require('../library/glyphsLibrary');

const VISUAL_VERSION = 2;
const VISIBLE_GLYPH_COUNT = 28; // 28 bits (268 435 456 combinaisons uniques)
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

        const types = ['square', 'rect', 'circle', 'diamond', 'plus'];
        return types[visibleIndex % types.length];
    },

    getGeometry(width, height) {
        const outerRadius = Math.min(width, height) / 2 - 15;
        const centerX = width / 2;
        const centerY = height / 2;
        
        // Taille équilibrée pour combler l'espace sans étouffer les glyphes
        const logoSize = 350; 
        const logoRadius = logoSize / 2;

        const outerRingRadius = outerRadius - 25;
        // Rayon ajusté pour resserrer le cercle de glyphes autour du logo
        const singleRingRadius = outerRingRadius - 48; 

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
            -Math.PI / 2, // Nord (Mire de départ)
            0,            // Est
            Math.PI / 2,  // Sud
            Math.PI       // Ouest
        ];
    },

    getVisiblePositions() {
        const positions = [];
        const count = VISIBLE_GLYPH_COUNT;
        
        // Décalage angulaire d'un demi-pas pour éviter que les glyphes ne touchent les mires
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
        const width = Math.max(400, Math.round(options.width || 800));
        const height = Math.max(400, Math.round(options.height || 800));

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

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
            options.lot;

        if (!rawBatchName) {
            throw new Error('[sealRenderer] Aucun lot fourni.');
        }

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

        // Cercle extérieur global
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 6 * scale;
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRingRadius + 18 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Logo central positionné plus haut pour isoler le texte
        const logoPath =
            options.logoPath ||
            payload.logoPath ||
            path.join(__dirname, '../assets/logo_anor_master.png');

        const logoCenterY = centerY - 65 * scale;

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

        // Mires cardinales (Nord, Sud, Est, Ouest)
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

            if (i === 0) {
                ctx.lineWidth = 5 * scale;
                ctx.strokeRect(-16, -16, 32, 32);
                ctx.fillRect(-7, -7, 14, 14);
            } else {
                ctx.lineWidth = 4 * scale;
                ctx.strokeRect(-14, -14, 28, 28);
                ctx.fillRect(-5, -5, 10, 10);
            }
            ctx.restore();
        }
        ctx.restore();

        // Rendu des glyphes (parfaitement décalés des mires)
        const positions = this.getVisiblePositions();
        const glyphScale = 1.35; 
        const strokeWidth = 4.5;

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

            ctx.shadowColor = 'rgba(0, 0, 0, 0.40)';
            ctx.shadowBlur = 3.5 * scale;
            ctx.shadowOffsetX = 1.2 * scale;
            ctx.shadowOffsetY = 1.2 * scale;

            drawGlyphWithRelief2D(
                ctx,
                glyphType,
                glyphDef,
                isFilled,
                glyphScale,
                strokeWidth,
                scale
            );

            ctx.restore();
        }
        ctx.restore();

        // Texte placé plus bas avec une marge dégagée nette sous le logo
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = centerY + 148 * scale;

        // Numéro de Lot très net et lisible
        ctx.font = `900 ${Math.max(28, Math.round(38 * scale))}px sans-serif`;
        ctx.fillStyle = TEXT_PRIMARY_COLOR;
        ctx.fillText(`LOT ${batchText}`, centerX, textY - 14 * scale);

        // Numéro de Série
        ctx.font = `bold ${Math.max(16, Math.round(22 * scale))}px sans-serif`;
        ctx.fillStyle = TEXT_SECONDARY_COLOR;
        ctx.fillText(`SÉRIE : ${itemText}`, centerX, textY + 18 * scale);

        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

function drawGlyphWithRelief2D(ctx, type, def, isFilled, glyphScale = 1, strokeWidth = 4, scale = 1) {
    const width = (def.width || 18) * glyphScale;
    const height = (def.height || 18) * glyphScale;

    ctx.lineWidth = strokeWidth;

    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';

    switch (type) {
        case 'square':
        case 'rect':
            if (isFilled) {
                ctx.fillRect(-width / 2, -height / 2, width, height);
                ctx.fillStyle = '#333333';
                ctx.fillRect(-width / 2 + 2, -height / 2 + 2, width - 4, height - 4);
            } else {
                ctx.strokeRect(-width / 2, -height / 2, width, height);
            }
            break;

        case 'circle': {
            ctx.beginPath();
            ctx.arc(0, 0, (def.radius || width / 2) * glyphScale, 0, Math.PI * 2);
            if (isFilled) {
                ctx.fill();
            } else {
                ctx.stroke();
            }
            break;
        }

        case 'diamond': {
            ctx.save();
            ctx.rotate((def.rotation || 45) * Math.PI / 180);
            if (isFilled) {
                ctx.fillRect(-width / 2, -height / 2, width, height);
            } else {
                ctx.strokeRect(-width / 2, -height / 2, width, height);
            }
            ctx.restore();
            break;
        }

        case 'plus': {
            const arm = Math.max(strokeWidth * 1.35, width * 0.18);
            if (isFilled) {
                ctx.fillRect(-width / 2, -arm / 2, width, arm);
                ctx.fillRect(-arm / 2, -height / 2, arm, height);
            } else {
                ctx.beginPath();
                ctx.moveTo(-width / 2, 0);
                ctx.lineTo(width / 2, 0);
                ctx.moveTo(0, -height / 2);
                ctx.lineTo(0, height / 2);
                ctx.stroke();
            }
            break;
        }

        default:
            if (isFilled) {
                ctx.fillRect(-width / 2, -height / 2, width, height);
            } else {
                ctx.strokeRect(-width / 2, -height / 2, width, height);
            }
    }
}

module.exports = sealRenderer;