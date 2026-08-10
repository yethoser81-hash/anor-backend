/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V5.0
 *
 * PROTOCOLE VISUEL V1
 *
 * Anneaux visibles :
 *   Interne  : 7
 *   Médian   : 24
 *   Externe  : 20
 *   TOTAL    : 51
 *
 * Les 51 positions visibles portent chacune 1 bit visuel.
 * Le bit est matérialisé par le centre du glyphe :
 *
 *   bit 1 = centre bleu
 *   bit 0 = petit évidement central
 *
 * Les 4 mires cardinales ne comptent PAS comme glyphes.
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

    /**
     * Génère exactement 51 bits à partir de la signature serveur.
     */
    deriveVisualBits(seed) {

        const digest = crypto
            .createHash('sha256')
            .update(`ANOR_VISUAL_V${VISUAL_VERSION}:${String(seed)}`)
            .digest();

        let bits = '';

        for (const byte of digest) {      bits += byte.toString(2).padStart(8, '0');        }

        return bits.slice(0, VISIBLE_GLYPH_COUNT);    },

    /**
     * Vérifie une matrice binaire ANOR.
     */
    normalizeVisualBits(bits) {

        if (
            typeof bits === 'string' &&
            /^[01]{51}$/.test(bits)
        ) {            return bits;     }

        return null;    },

    async renderSealToBuffer(payload = {}, options = {}) {

        const width = options.width || 800;
        const height = options.height || 800;

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const centerX = width / 2;
        const centerY = height / 2;

        const GEOMETRY_COLOR =
            options.geometryColor || '#4A90E2';

        // =========================================================
        // 1. IDENTIFICATION
        // =========================================================

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
                "[sealRenderer] Aucun lot ou nom de produit fourni."
            );
        }

        const batchText =
            String(rawBatchName)
                .toUpperCase()
                .startsWith("LOT")
                ? String(rawBatchName).toUpperCase()
                : `LOT ${String(rawBatchName).toUpperCase()}`;

        const rawItemNumber =
            payload.itemNumber ??
            options.itemNumber ??
            payload.serialNumber ??
            options.serial;

        let itemText = "";

        if (
            rawItemNumber !== undefined &&
            rawItemNumber !== null &&
            !options.isMasterSeal &&
            !payload.isMasterSeal
        ) {
            itemText = `N° ${rawItemNumber}`;
        } else {
            itemText = "DM / 000 000";
        }

        // =========================================================
        // 2. SIGNATURE / MATRICE VISUELLE
        // =========================================================

        const secureSignature =
            payload.secureSignature ||
            payload.glyph_payload?.secureSignature ||
            null;

        const visualBits =
            this.normalizeVisualBits(
                payload.visualBits ||
                payload.glyph_payload?.visualBits
            ) ||
            this.deriveVisualBits(
                secureSignature || rawBatchName
            );

        if (!visualBits) {
            throw new Error(
                "[sealRenderer] Impossible de produire les 51 bits visuels."
            );
        }

        // Seed indépendant utilisé uniquement pour la variété
        // géométrique des glyphes.
        const uniqueSeedSource =
            payload.productId ||
            payload.id ||
            payload.batchId ||
            rawBatchName;

        const hashSeed =
            crypto
                .createHash('sha256')
                .update(`ANOR_SEAL_${uniqueSeedSource}`)
                .digest('hex');

        ctx.clearRect(0, 0, width, height);

        // =========================================================
        // 3. CERCLE EXTÉRIEUR
        // =========================================================

        const outerRadius =         (Math.min(width, height) / 2) - 25;

        ctx.save();

        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 5;

        ctx.beginPath();
        ctx.arc(       centerX,      centerY,     outerRadius,     0,      Math.PI * 2    );

        ctx.stroke();

        ctx.restore();

        // =========================================================
        // 4. LOGO CENTRAL
        // =========================================================

        const logoSize = 220;
        const logoRadius = logoSize / 2;

        const logoPath =
            options.logoPath ||
            payload.logoPath ||
            path.join(
                __dirname,
                "../assets/logo_anor_master.png"
            );

        if (fs.existsSync(logoPath)) {

            try {

                const img = await loadImage(logoPath);

                ctx.drawImage(     img,     centerX - logoRadius,     centerY - logoRadius - 35,    logoSize,      logoSize     );

            } catch (error) {     console.error(      "[ERREUR LOGO]",
                    error      );            }
        }

        // =========================================================
        // 5. GÉOMÉTRIE DES ANNEAUX
        // =========================================================

        const innerRingRadius =
            logoRadius + 45;

        const outerRingRadius =
            outerRadius - 30;

        const midRingRadius =
            (innerRingRadius + outerRingRadius) / 2;

        const finderCardinals = [
            0,
            Math.PI / 2,
            Math.PI,
            (3 * Math.PI) / 2
        ];

        const ringConfigs = [

            {
                name: 'inner',
                radius: innerRingRadius,
                count: 12,
                isInner: true,
                hasFinders: false
            },

            {
                name: 'middle',
                radius: midRingRadius,
                count: 24,
                isInner: false,
                hasFinders: false
            },

            {
                name: 'outer',
                radius: outerRingRadius,
                count: 32,
                isInner: false,
                hasFinders: true
            }

        ];

        // =========================================================
        // 6. GLYPHES
        // =========================================================

        const matrixData =
            payload.matrix ||
            payload.glyph_payload?.matrix ||
            [];

        ctx.save();

        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 3.5;

        let globalIndexOffset = 0;
        let visibleIndex = 0;

        const scale =
            outerRadius / CANONICAL_OUTER_RADIUS;

        const markerSize =
            Math.max(
                4,
                Math.round(8 * scale)
            );

        for (const ringConfig of ringConfigs) {

            const {
                radius: r,
                count: numPerRing,
                isInner,
                hasFinders
            } = ringConfig;

            for (let i = 0; i < numPerRing; i++) {

                const globalIndex =
                    globalIndexOffset + i;

                const angle =
                    (i / numPerRing) *
                    Math.PI * 2;

                const angleDeg =
                    (angle * 180) / Math.PI;

                // -------------------------------------------------
                // Anneau interne :
                // 12 positions théoriques
                // 5 supprimées
                // => 7 visibles
                // -------------------------------------------------

                if (     isInner &&          angleDeg >= 20 &&             angleDeg <= 160
                ) {                    continue;                }

                // -------------------------------------------------
                // Anneau externe :
                // suppression des positions qui touchent les mires
                // -------------------------------------------------

                if (hasFinders) {

                    let collidesWithFinder = false;

                    for (     const targetAngle
                        of finderCardinals            ) {

                        let diff =      Math.abs(      angle -  targetAngle           );

                        if (diff > Math.PI) {   diff =     (Math.PI * 2) -    diff;                       }

                        if (diff < 0.30) {         collidesWithFinder = true;
                            break;                        }                    }

                    if (collidesWithFinder) {     continue;    }           }

                // -------------------------------------------------
                // Sécurité
                // -------------------------------------------------

                if (visibleIndex >= VISIBLE_GLYPH_COUNT) {
                    throw new Error(
                        "[sealRenderer] Plus de 51 positions visuelles."
                    );
                }

                // -------------------------------------------------
                // Glyphe
                // -------------------------------------------------

                const hashByte =
                    parseInt(
                        hashSeed.substring(
                            (globalIndex * 2) % 60,
                            ((globalIndex * 2) % 60) + 2
                        ),
                        16
                    ) || globalIndex;

                const item =    matrixData[globalIndex] || {};
                const glyphType =        item.glyph ||             GlyphsLibrary.resolveGlyph(hashByte);
                const glyphDef =                    GlyphsLibrary.getGlyphDefinition(    glyphType       );

                if (!glyphDef) {    throw new Error(  `Glyphe inconnu : ${glyphType}` );                }

                const isFilled =     item.filled !== undefined    ? item.filled   : hashByte % 2 === 0;
                const visualBit =     visualBits[visibleIndex] === '1';
                const px =           centerX +           r * Math.cos(angle);
                const py =        centerY +              r * Math.sin(angle);

                ctx.save();
                ctx.translate(px, py);
                ctx.rotate(angle);

                drawGlyphFromDefinition(     ctx,     glyphType,   glyphDef,  isFilled        );

                // -------------------------------------------------
                // MARQUEUR BINAIRE CENTRAL
                //
                // 1 = centre bleu
                // 0 = évidement central
                //
                // Ce marqueur est ce que lit le téléphone.
                // -------------------------------------------------

                if (visualBit) {       ctx.globalCompositeOperation =       'source-over';

                    ctx.fillStyle =                        GEOMETRY_COLOR;
                    ctx.fillRect(     -markerSize / 2,     -markerSize / 2, markerSize,    markerSize                    );
                } else {     ctx.globalCompositeOperation =           'destination-out';

                    ctx.fillRect(    -markerSize / 2,      -markerSize / 2,    markerSize,  markerSize                    );
                    ctx.globalCompositeOperation =
                        'source-over';              }

                ctx.restore();
                visibleIndex++;            }

            globalIndexOffset += numPerRing;        }

        if (visibleIndex !== VISIBLE_GLYPH_COUNT) {       throw new Error(
                `[sealRenderer] Géométrie invalide : ${visibleIndex}/51 glyphes visibles.`
            );        }

        // =========================================================
        // 5.2 MIRES CARDINALES
        // =========================================================

        finderCardinals.forEach(targetAngle => {
            const px =        centerX +   outerRingRadius *      Math.cos(targetAngle);
            const py =    centerY +   outerRingRadius *   Math.sin(targetAngle);

            ctx.save();
            ctx.translate(px, py);
            ctx.lineWidth = 4;
            ctx.strokeStyle = GEOMETRY_COLOR;
            ctx.fillStyle = GEOMETRY_COLOR;
            ctx.strokeRect(     -15,      -15,       30,         30       );
            ctx.fillRect(      -6,          -6,        12,        12        );
            ctx.restore();        });
        ctx.restore();

        // =========================================================
        // 6. TEXTE
        // =========================================================

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const textY =         centerY + 115;
        const drawOutlinedText =            (      txt,     x,    y,     fontStyle,      textColor = '#FFFFFF'
            ) => {     ctx.font = fontStyle;    ctx.strokeStyle = '#000000';   ctx.lineWidth = 5.5; ctx.lineJoin = 'round';

                ctx.strokeText(   txt,    x,   y   );
                ctx.fillStyle = textColor;
                ctx.fillText(   txt,      x,         y  );          };

        drawOutlinedText(   batchText,   centerX,   textY - 18,   'bold 28px sans-serif',     '#FFFFFF'        );
        drawOutlinedText(   itemText,   centerX,    textY + 22,    'bold 26px monospace',    '#E2E8F0'  );
        ctx.restore();
        return canvas.toBuffer('image/png');    }
};

function drawGlyphFromDefinition(    ctx,    type,    def,    isFilled
) {    ctx.beginPath();

    switch (type) {
        case 'square':
        case 'rect':
            if (isFilled) {   ctx.fillRect(   -def.width / 2,   -def.height / 2,   def.width,    def.height );
            } else {         ctx.strokeRect(    -def.width / 2,    -def.height / 2,     def.width,    def.height ); }
            break;

        case 'circle':

            ctx.arc(    0,    0,     def.radius ||    (def.width / 2),      0,     Math.PI * 2    );

            if (isFilled) {        ctx.fill();    }             else {        ctx.stroke();            }
            break;

        case 'diamond':

            ctx.rotate(   (def.rotation || 45) *   Math.PI /         180            );

            if (isFilled) {   ctx.fillRect(  -def.width / 2,  -def.height / 2,    def.width,   def.height);
            } else {    ctx.strokeRect(   -def.width / 2,  -def.height / 2,   def.width,  def.height   );
            }

            break;
        case 'plus': { const hW =    def.width / 2;      const hH =    def.height / 2;

            ctx.moveTo(  -hW,   0  );         ctx.lineTo(  hW,    0    );
            ctx.moveTo(   0,   -hH   );      ctx.lineTo(   0,    hH  );
            ctx.stroke();
            break;     }

        default:
            if (isFilled) {   ctx.fillRect(  -def.width / 2,  -def.height / 2,   def.width,   def.height );
            } else {    ctx.strokeRect(  -def.width / 2,    -def.height / 2,      def.width,   def.height );            }
            break;    }
}

module.exports = sealRenderer;