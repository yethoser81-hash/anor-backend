/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V6.9 - BLOC TEXTE COMPACT & SÉRIE HAUTE LISIBILITÉ (2.5CM)
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
        if (
            typeof bits === 'string' &&
            /^[01]{51}$/.test(bits)
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
        const outerRadius = Math.min(width, height) / 2 - 25;
        const centerX = width / 2;
        const centerY = height / 2;
        
        const logoSize = 180; 
        const logoRadius = logoSize / 2;

        const innerRingRadius = logoRadius + 50; 
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
        return [
            0,
            Math.PI / 2,
            Math.PI,
            (3 * Math.PI) / 2
        ];
    },

    isOuterFinderCollision(angle) {
        for (const targetAngle of this.getFinderAngles()) {
            let diff = Math.abs(angle - targetAngle);
            if (diff > Math.PI) {
                diff = (Math.PI * 2) - diff;
            }
            if (diff < 0.31) {
                return true;
            }
        }
        return false;
    },

    getVisiblePositions() {
        const positions = [];

        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const deg = angle * 180 / Math.PI;
            if (deg >= 20 && deg <= 160) {
                continue;
            }
            positions.push({
                ring: 'inner',
                ringPosition: i,
                theoreticalCount: 12
            });
        }

        for (let i = 0; i < 24; i++) {
            positions.push({
                ring: 'middle',
                ringPosition: i,
                theoreticalCount: 24
            });
        }

        for (let i = 0; i < 32; i++) {
            const angle = (i / 32) * Math.PI * 2;
            if (this.isOuterFinderCollision(angle)) {
                continue;
            }
            positions.push({
                ring: 'outer',
                ringPosition: i,
                theoreticalCount: 32
            });
        }

        if (positions.length !== VISIBLE_GLYPH_COUNT) {
            throw new Error(
                `[sealRenderer] Géométrie protocolaire invalide : ${positions.length}/51.`
            );
        }

        return positions;
    },

    async renderSealToBuffer(payload = {}, options = {}) {
        const width = Math.max(400, Math.round(options.width || 800));
        const height = Math.max(400, Math.round(options.height || 800));

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const GEOMETRY_COLOR = options.geometryColor || '#3B9CFF';
        const backgroundColor = options.backgroundColor;

        const geometry = this.getGeometry(width, height);
        const {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            innerRingRadius,
            midRingRadius,
            outerRingRadius
        } = geometry;

        const scale = outerRadius / CANONICAL_OUTER_RADIUS;

        if (backgroundColor) {
            ctx.save();
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, width, height);
            ctx.restore();
        }

        const rawBatchName =
            payload.lot ||
            payload.batchNumber ||
            payload.batchName ||
            payload.productName ||
            payload.name ||
            options.batchNumber ||
            options.lot;

        if (!rawBatchName) {
            throw new Error(
                '[sealRenderer] Aucun lot ou nom de produit fourni.'
            );
        }

        const normalizedBatchName = String(rawBatchName)
            .trim()
            .toUpperCase();

        const batchText = normalizedBatchName.startsWith('LOT')
            ? normalizedBatchName
            : `LOT ${normalizedBatchName}`;

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
                ? `N° ${rawItemNumber}`
                : 'DM / 000 000';

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
            throw new Error(
                '[sealRenderer] Matrice visuelle invalide : 51 bits requis.'
            );
        }

        // ------------------------------------------------------------
        // 3. CERCLE EXTERIEUR
        // ------------------------------------------------------------
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // ------------------------------------------------------------
        // 4. RENDU DU LOGO (STRICTEMENT AU CENTRE)
        // ------------------------------------------------------------
        const logoPath =
            options.logoPath ||
            payload.logoPath ||
            path.join(__dirname, '../assets/logo_anor_master.png');

        if (fs.existsSync(logoPath)) {
            try {
                const img = await loadImage(logoPath);
                const logoOffsetY = 0;
                ctx.drawImage(
                    img,
                    centerX - logoRadius,
                    centerY + logoOffsetY - logoRadius,
                    logoSize,
                    logoSize
                );
            } catch (error) {
                console.error('[sealRenderer] Erreur lors du chargement du logo :', error);
            }
        } else {
            console.warn('[sealRenderer] Avertissement : Le fichier logo est introuvable au chemin :', logoPath);
        }

        // ------------------------------------------------------------
        // 5. GLYPHES
        // ------------------------------------------------------------
        const positions = this.getVisiblePositions();
        const glyphScale = Number.isFinite(options.glyphScale)
            ? Math.max(0.9, Math.min(1.45, options.glyphScale))
            : 1.20;
        const strokeWidth = Number.isFinite(options.glyphStrokeWidth)
            ? Math.max(2, Math.min(7, options.glyphStrokeWidth))
            : 4;

        const rings = {
            inner: innerRingRadius,
            middle: midRingRadius,
            outer: outerRingRadius
        };

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let visibleIndex = 0; visibleIndex < positions.length; visibleIndex++) {
            const position = positions[visibleIndex];
            const radius = rings[position.ring];
            const angle =
                (position.ringPosition / position.theoreticalCount) *
                Math.PI * 2;

            const px = centerX + radius * Math.cos(angle);
            const py = centerY + radius * Math.sin(angle);

            const glyphType = this.resolveProtocolGlyph(visibleIndex);
            const glyphDef = GlyphsLibrary.getGlyphDefinition(glyphType);

            if (!glyphDef) {
                throw new Error(
                    `[sealRenderer] Glyphe inconnu : ${glyphType}`
                );
            }

            const isFilled = visualBits[visibleIndex] === '1';

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);

            drawGlyphFromDefinition(
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

        // ------------------------------------------------------------
        // 6. MIRES CARDINALES
        // ------------------------------------------------------------
        const finderSize = Math.max(
            30,
            Math.round((outerRadius / CANONICAL_OUTER_RADIUS) * 44)
        );
        const finderCore = Math.max(
            12,
            Math.round(finderSize * 0.40)
        );

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.lineWidth = Math.max(
            4,
            Math.round((outerRadius / CANONICAL_OUTER_RADIUS) * 5)
        );

        for (const targetAngle of this.getFinderAngles()) {
            const px = centerX + outerRingRadius * Math.cos(targetAngle);
            const py = centerY + outerRingRadius * Math.sin(targetAngle);

            ctx.save();
            ctx.translate(px, py);
            ctx.strokeRect(
                -finderSize / 2,
                -finderSize / 2,
                finderSize,
                finderSize
            );
            ctx.fillRect(
                -finderCore / 2,
                -finderCore / 2,
                finderCore,
                finderCore
            );
            ctx.restore();
        }
        ctx.restore();

        // ------------------------------------------------------------
        // 7. BLOC TEXTE (LOT & SÉRIE) - COMPACT ET HAUTE LISIBILITÉ
        // ------------------------------------------------------------
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = centerY + 128 * scale; 
        const boxWidth = 230 * scale; // Largeur réduite et compacte
        const boxHeight = 52 * scale;

        // Boîte blanche de fond
        ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
        ctx.beginPath();
        ctx.roundRect(centerX - boxWidth / 2, textY - boxHeight / 2, boxWidth, boxHeight, 8 * scale);
        ctx.fill();
        
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 1.6 * scale;
        ctx.stroke();

        const drawOutlinedText = (
            text,
            x,
            y,
            font,
            textColor
        ) => {
            ctx.font = font;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = Math.max(3, 4 * scale);
            ctx.lineJoin = 'round';
            ctx.strokeText(text, x, y);
            ctx.fillStyle = textColor;
            ctx.fillText(text, x, y);
        };

        // Nom du Lot
        drawOutlinedText(
            batchText,
            centerX,
            textY - 9 * scale,
            `bold ${Math.max(20, Math.round(24 * scale))}px sans-serif`,
            '#0F172A'
        );

        // Numéro de série / DM (agrandi et renforcé pour impression 2.5cm)
        drawOutlinedText(
            itemText,
            centerX,
            textY + 13 * scale,
            `bold ${Math.max(16, Math.round(20 * scale))}px monospace`,
            '#1D4ED8'
        );

        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

function drawGlyphFromDefinition(
    ctx,
    type,
    def,
    isFilled,
    glyphScale = 1,
    strokeWidth = 4
) {
    const width = def.width * glyphScale;
    const height = def.height * glyphScale;

    ctx.lineWidth = strokeWidth;

    switch (type) {
        case 'square':
        case 'rect':
            if (isFilled) {
                ctx.fillRect(
                    -width / 2,
                    -height / 2,
                    width,
                    height
                );
            } else {
                ctx.strokeRect(
                    -width / 2,
                    -height / 2,
                    width,
                    height
                );
            }
            break;

        case 'circle': {
            ctx.beginPath();
            ctx.arc(
                0,
                0,
                (def.radius || def.width / 2) * glyphScale,
                0,
                Math.PI * 2
            );
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
                ctx.fillRect(
                    -width / 2,
                    -height / 2,
                    width,
                    height
                );
            } else {
                ctx.strokeRect(
                    -width / 2,
                    -height / 2,
                    width,
                    height
                );
            }
            ctx.restore();
            break;
        }

        case 'plus': {
            const arm = Math.max(
                strokeWidth * 1.35,
                width * 0.18
            );

            if (isFilled) {
                ctx.fillRect(
                    -width / 2,
                    -arm / 2,
                    width,
                    arm
                );
                ctx.fillRect(
                    -arm / 2,
                    -height / 2,
                    arm,
                    height
                );
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
                ctx.fillRect(
                    -width / 2,
                    -height / 2,
                    width,
                    height
                );
            } else {
                ctx.strokeRect(
                    -width / 2,
                    -height / 2,
                    width,
                    height
                );
            }
    }
}

module.exports = sealRenderer;