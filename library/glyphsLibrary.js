/**
 * ====================================================================
 * ANOR CHECK
 * GLYPHS LIBRARY V6.0 - TRUTHMODE
 *
 * SOURCE DE VÉRITÉ DES GLYPHES
 *
 * Types :
 *   - square
 *   - rect
 *   - circle
 *   - diamond
 *   - plus
 *
 * OBJECTIF :
 *
 * Cette bibliothèque décrit la géométrie des glyphes et fournit
 * une logique commune permettant au SealDecoder de déterminer :
 *
 *   1. quelle forme est attendue ;
 *   2. quelle surface théorique doit être analysée ;
 *   3. quelle proportion de cette surface paraît occupée ;
 *   4. si le glyphe est vide ou plein ;
 *   5. le bit correspondant ;
 *   6. un niveau de confiance ;
 *   7. les paramètres nécessaires à une reconstruction géométrique.
 *
 * IMPORTANT :
 *
 * Le bit ne dépend PAS de la luminosité absolue.
 *
 * Il dépend de l'état logique du glyphe :
 *
 *        VIDE  -> 0
 *        PLEIN -> 1
 *
 * L'environnement lumineux doit donc influencer la mesure,
 * mais ne doit pas changer la logique du protocole.
 *
 * ====================================================================
 */

const GlyphsLibrary = {

    /**
     * ================================================================
     * TYPES OFFICIELS
     * ================================================================
     */

    types: [   "square",  "rect",  "circle",  "diamond",    "plus"    ],

    /**
     * ================================================================
     * VERSION DU PROTOCOLE GLYPHES
     * ================================================================
     */

    VERSION: "6.0.0",

    /**
     * ================================================================
     * LOGIQUE TRUTHMODE
     * ================================================================
     *
     * On évite de prendre une décision brutale sur un seul seuil.
     *
     * Exemple :
     *
     *   fillRatio < 0.45
     *       -> VIDE
     *
     *   fillRatio > 0.55
     *       -> PLEIN
     *
     *   entre les deux
     *       -> ZONE INCERTAINE
     *
     * La zone incertaine pourra ensuite être traitée par le
     * SealDecoder avec reconstruction / multi-échantillonnage.
     */

    TRUTHMODE: {

        /**
         * Limite maximale pour considérer un glyphe vide.
         */
        emptyThreshold: 0.45,

        /**
         * Limite minimale pour considérer un glyphe plein.
         */
        fullThreshold: 0.55,

        /**
         * Marge de sécurité protocolaire.
         *
         * Le système vise une décision très forte lorsque la
         * mesure est éloignée de la zone ambiguë.
         */
        validationMargin: 0.05,

        /**
         * Valeur minimale de confiance recherchée pour une
         * décision automatique.
         */
        minimumConfidence: 0.95,

        /**
         * Lorsque le glyphe est trop petit, la reconstruction
         * géométrique doit prendre davantage d'importance.
         */
        reconstructionThreshold: 0.70
    },


    /**
     * ================================================================
     * PARAMÈTRES DE MESURE
     * ================================================================
     */

    MEASUREMENT: {

        /**
         * Nombre de niveaux d'analyse.
         *
         * Le SealDecoder peut utiliser ces niveaux pour effectuer
         * plusieurs mesures du même glyphe.
         */
        passes: 5,

        /**
         * Pourcentage minimal de la forme qui doit être analysable.
         */
        minimumCoverage: 0.60,

        /**
         * Tolérance aux bords.
         */
        edgeTolerance: 0.15,

        /**
         * Taille minimale théorique utile en pixels.
         */
        minimumGlyphPixels: 3,

        /**
         * Nombre de pixels de reconstruction conseillé.
         */
        reconstructionSize: 32
    },

    /**
     * ================================================================
     * DÉFINITIONS DES GLYPHES
     * ================================================================
     *
     * Les dimensions correspondent au renderer actuel.
     *
     * Elles constituent la géométrie canonique.
     */

    definitions: {        square: {    type: "square",    width: 18,   height: 18,    sides: 4,    symmetry: "rotational",     orientation: 0,

            /**
             * La surface théorique du carré.
             */
            areaModel: "rectangle",

            /**
             * Reconstruction géométrique.
             */
            reconstruction: "square"
        },

        rect: { type: "rect",  width: 36,  height: 9, sides: 4, symmetry: "horizontal", orientation: 0, areaModel: "rectangle", reconstruction: "rectangle"  },

        circle: { type: "circle", width: 18, height: 18, radius: 9, symmetry: "radial", orientation: 0, areaModel: "circle", reconstruction: "circle"      },

        diamond: {  type: "diamond",  width: 16,  height: 16,   rotation: 45,  symmetry: "rotational",  orientation: 45, areaModel: "diamond", reconstruction: "diamond"  },

        plus: { type: "plus",  width: 20,  height: 20, symbol: "+", symmetry: "cross",  orientation: 0, areaModel: "plus", reconstruction: "plus"     }
    },

    /**
     * ================================================================
     * RÉSOLUTION D'UN GLYPHE
     * ================================================================
     */

    resolveGlyph(index) {        const safeIndex =            Number.isFinite(Number(index))
                ? Math.abs(
                    Math.floor(                        Number(index)
                    )                )
                : 0;
        return this.types[  safeIndex %    this.types.length        ];    },

    /**
     * ================================================================
     * OBTENIR LA DÉFINITION
     * ================================================================
     */

    getGlyphDefinition(type) {

        if (            !type ||
            !this.definitions[type]
        ) {
            return { type: "unknown",  width: 18,    height: 18,  areaModel: "rectangle",   reconstruction: "rectangle"     };        }

        /**
         * On retourne une copie afin d'éviter qu'un autre module
         * modifie accidentellement la définition canonique.
         */

        return {            ...this.definitions[type]        };    },

    /**
     * ================================================================
     * SURFACE THÉORIQUE
     * ================================================================
     *
     * Sert à comparer les pixels réellement détectés à la surface
     * que devrait occuper le glyphe.
     */

    getTheoreticalArea(type) {
        const glyph =            this.getGlyphDefinition(type);

        switch (glyph.areaModel) {

            case "circle":
                return Math.PI *
                    Math.pow(                        glyph.radius,                        2                    );


            case "diamond":

                /**
                 * Diamant défini par ses diagonales.
                 *
                 * Aire = D1 * D2 / 2
                 */

                return (   glyph.width *     glyph.height      ) / 2;

            case "plus": {

                /**
                 * Le plus est constitué de deux rectangles
                 * superposés.
                 *
                 * La largeur de la branche est estimée à 1/3
                 * de la largeur globale.
                 */

                const branch =                    glyph.width / 3;
                const horizontal =                    glyph.width *                    branch;
                const vertical =                    glyph.height *                    branch;
                const overlap =                    branch *                    branch;

                return (  horizontal +    vertical -      overlap                );            }

            case "rectangle":            default:

                return (   glyph.width *                    glyph.height                );        }    },

    /**
     * ================================================================
     * NORMALISATION DU TAUX DE REMPLISSAGE
     * ================================================================
     *
     * Le SealDecoder peut envoyer plusieurs mesures.
     *
     * Cette fonction garantit une valeur comprise entre 0 et 1.
     */

    normalizeFillRatio(value) {        const number =            Number(value);

        if (            !Number.isFinite(number)
        ) {            return 0;        }

        return Math.max(   0,    Math.min(   1,    number   )        );    },

    /**
     * ================================================================
     * CLASSIFICATION LOGIQUE
     * ================================================================
     *
     * Retour :
     *
     *   EMPTY
     *   FULL
     *   UNCERTAIN
     */

    classifyFill(fillRatio) {
        const ratio =            this.normalizeFillRatio(                fillRatio            );

        if (   ratio <=  this.TRUTHMODE.emptyThreshold
        ) {            return "EMPTY";        }

        if (   ratio >=   this.TRUTHMODE.fullThreshold
        ) {            return "FULL";        }

        return "UNCERTAIN";    },

    /**
     * ================================================================
     * CONVERSION ÉTAT -> BIT
     * ================================================================
     *
     * C'est ici que se trouve la logique protocolaire fondamentale.
     *
     * EMPTY -> 0
     * FULL  -> 1
     *
     * UNCERTAIN n'est PAS arbitrairement transformé en 0 ou 1.
     *
     * Le décodeur devra alors demander une nouvelle mesure ou
     * utiliser la reconstruction.
     */

    stateToBit(state) {

        if (            state === "FULL"
        ) {            return 1;        }


        if (            state === "EMPTY"
        ) {            return 0;        }
        return null;    },


    /**
     * ================================================================
     * CALCUL DE CONFIANCE
     * ================================================================
     *
     * Plus on s'éloigne de la zone ambiguë, plus la confiance monte.
     */

    calculateConfidence(fillRatio) {
        const ratio =
            this.normalizeFillRatio(                fillRatio            );

        const emptyThreshold =            this.TRUTHMODE.emptyThreshold;
        const fullThreshold =            this.TRUTHMODE.fullThreshold;

        /**
         * Zone vide.
         */

        if (  ratio <=            emptyThreshold
        ) {            return Number(
                Math.min(                    1,
                    (                        emptyThreshold -                        ratio                    ) /
                    emptyThreshold +
                    0.5
                ).toFixed(3)
            );        }

        /**
         * Zone pleine.
         */

        if (            ratio >=            fullThreshold        ) {

            return Number(
                Math.min(                    1,
                    (                        ratio -                        fullThreshold                    ) /
                    (          1 -           fullThreshold                    ) +                    0.5
                ).toFixed(3)            );        }

        /**
         * Zone ambiguë.
         */

        const distance =            Math.min(        ratio -       emptyThreshold,      fullThreshold -  ratio            );

        return Number(   Math.max(   0,    0.5 -    distance    ).toFixed(3)        );    },

    /**
     * ================================================================
     * ANALYSE D'UN GLYPHE
     * ================================================================
     *
     * Fonction principale destinée au SealDecoder.
     */

    analyzeGlyph(   type,   fillRatio,        options = {}
    ) {
        const glyph =            this.getGlyphDefinition(                type            );

        const ratio =            this.normalizeFillRatio(                fillRatio            );

        const state =            this.classifyFill(                ratio            );

        const confidence =            this.calculateConfidence(                ratio            );

        let bit =    this.stateToBit(                state            );

        /**
         * Si le caller impose un mode strict,
         * un glyphe incertain reste indéterminé.
         */

        if (            options.strict === true &&
            state === "UNCERTAIN"
        ) {            bit = null;        }

        return {
            type:                glyph.type,
            geometry:                glyph.reconstruction,
            fillRatio:                ratio,
            state,            bit,            confidence,            reliable:
                (
                    bit !== null &&
                    confidence >=                    this.TRUTHMODE.minimumConfidence                ),

            needsReconstruction:
                (
                    confidence <                    this.TRUTHMODE.minimumConfidence                ),

            definition:                glyph        };    },


    /**
     * ================================================================
     * COMPARAISON AVEC PLUSIEURS MESURES
     * ================================================================
     *
     * Le même glyphe peut être mesuré plusieurs fois :
     *
     *   - image originale
     *   - image normalisée
     *   - image contrastée
     *   - image reconstruite
     *   - image agrandie
     *
     * On recherche alors une décision majoritaire.
     */

    aggregateMeasurements(        type,        measurements = []
    ) {
        if (            !Array.isArray(measurements) ||            measurements.length === 0
        ) {
            return {
                type,
                state: "UNCERTAIN",
                bit: null,
                fillRatio: 0,
                confidence: 0,
                votes: {   empty: 0,       full: 0,     uncertain: 0      }            };        }


        const analyses =            measurements.map(                measurement => {

                    const ratio =                        typeof measurement ===
                        "object"
                            ? measurement.fillRatio
                            : measurement;

                    return this.analyzeGlyph(    type,     ratio     );                }            );


        let emptyVotes = 0;
        let fullVotes = 0;
        let uncertainVotes = 0;

        for (            const analysis            of analyses
        ) {
            if (                analysis.state ===                "EMPTY"
            ) {
                emptyVotes++;
            }

            else if (                analysis.state ===                "FULL"
            ) {
                fullVotes++;
            }

            else {                uncertainVotes++;            }        }

        /**
         * Moyenne pondérée des mesures.
         */

        const average =            analyses.reduce(
                (                    sum,                    item
                ) =>
                    sum +
                    item.fillRatio,
                0
            ) /
            analyses.length;


        let state =            "UNCERTAIN";

        if (   fullVotes >    emptyVotes &&   fullVotes >   uncertainVotes
        ) {
            state =                "FULL";        }

        else if (   emptyVotes >     fullVotes &&     emptyVotes >     uncertainVotes
        ) {
            state =
                "EMPTY";
        }

        const bit =            this.stateToBit(                state            );

        /**
         * La confiance dépend à la fois de la moyenne et du
         * consensus des différentes mesures.
         */

        const baseConfidence =    this.calculateConfidence(                average            );
        const winningVotes =            Math.max(    emptyVotes,                fullVotes            );
        const consensus =            winningVotes /            analyses.length;
        const confidence =     Number(
                Math.min(                    1,
                    (
                        baseConfidence *
                        0.60
                    ) +
                    (
                        consensus *
                        0.40
                    )
                ).toFixed(3)
            );


        return {            type,            state,            bit,            fillRatio:
                Number(                    average.toFixed(4)                ),

            confidence,
            reliable:
                (
                    bit !== null &&
                    confidence >=
                    this.TRUTHMODE.minimumConfidence
                ),

            votes: {
                empty:                    emptyVotes,
                full:                    fullVotes,
                uncertain:                    uncertainVotes
            },

            measurements:                analyses
        };    },

    /**
     * ================================================================
     * PROFIL DE RECONSTRUCTION
     * ================================================================
     *
     * Cette fonction ne reconstruit pas encore l'image.
     *
     * Elle fournit au SealDecoder les informations nécessaires
     * pour que son futur moteur de reconstruction sache quoi
     * reconstruire.
     */

    getReconstructionProfile(type) {

        const glyph =            this.getGlyphDefinition(                type            );
        const theoreticalArea =            this.getTheoreticalArea(                type            );

        return {            type,
            model:                glyph.reconstruction,
            width:                glyph.width,
            height:                glyph.height,            theoreticalArea,
            symmetry:                glyph.symmetry,
            orientation:                glyph.orientation ||                0,
            targetSize:                this.MEASUREMENT.reconstructionSize,
            minimumCoverage:                this.MEASUREMENT.minimumCoverage,
            edgeTolerance:                this.MEASUREMENT.edgeTolerance
        };    },

    /**
     * ================================================================
     * DÉCODAGE DIRECT
     * ================================================================
     *
     * Permet au SealDecoder de faire :
     *
     * GlyphsLibrary.decodeGlyph("circle", 0.82)
     *
     * -> bit 1
     *
     * ou :
     *
     * GlyphsLibrary.decodeGlyph("square", 0.18)
     *
     * -> bit 0
     */

    decodeGlyph(   type,    fillRatio,  options = {}
    ) {        return this.analyzeGlyph(            type,     fillRatio,    options   );    },

    /**
     * ================================================================
     * VALIDATION D'UN TYPE
     * ================================================================
     */

    isValidType(type) {

        return this.types.includes(
            type
        );
    },


    /**
     * ================================================================
     * INFORMATIONS PROTOCOLE
     * ================================================================
     *
     * Utile pour les logs et diagnostics.
     */

    getProtocolInfo() {
        return {
            version:
                this.VERSION,
            types:
                [...this.types],
            truthMode:
                {
                    ...this.TRUTHMODE
                },
            measurement:
                {
                    ...this.MEASUREMENT
                },
            definitions:
                Object.keys(
                    this.definitions
                ).reduce(
                    (
                        result,
                        type
                    ) => {

                        result[type] =
                            this.getGlyphDefinition(
                                type
                            );

                        return result;
                    },
                    {}
                )
        };    }};


/**
 * ====================================================================
 * EXPORTS
 * ====================================================================
 */

if (    typeof module !==    "undefined" &&    module.exports
) {    module.exports =        GlyphsLibrary;}
if (    typeof window !==    "undefined"
) {    window.GlyphsLibrary =        GlyphsLibrary;}