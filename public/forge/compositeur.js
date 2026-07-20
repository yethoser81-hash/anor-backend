// ==========================================
// ANOR V16.5 • Compositeur Géométrique Structuré
// 3 COURONNES • RÉPARTITION 360°
// Zone centrale réservée au logo
// Cartouche inférieur réservé à la sérialisation
// ==========================================

const Compositeur = {

    composer(signatureMaitre, options = {}) {

        const glyphes = [];

        //--------------------------------------------------
        // Générateur déterministe basé sur la signature
        //--------------------------------------------------

        let index = 0;

        function nextSeed() {

            if (!signatureMaitre) {
                return Math.random();
            }

            const c = signatureMaitre.charCodeAt(index % signatureMaitre.length);

            index++;

            return c / 255;

        }

        //--------------------------------------------------
        // Configuration
        //--------------------------------------------------

        const COURONNES = [

            {
                rayon: 190,
                total: 72,
                taille: "grand"
            },

            {
                rayon: 155,
                total: 88,
                taille: "moyen"
            },

            {
                rayon: 120,
                total: 104,
                taille: "petit"
            }

        ];

        //--------------------------------------------------
        // Triangle de repère officiel
        //--------------------------------------------------

        glyphes.push({

            forme: "anchor_top",

            rayon: 120,

            angle: -Math.PI / 2,

            plein: true,

            taille: "repere"

        });

        //--------------------------------------------------
        // Bibliothèque des formes
        //--------------------------------------------------

        const formes = [

            "rect_long",

            "rect_court",

            "square",

            "diamond",

            "circle",

            "double_circle",

            "triangle",

            "triangle_inverse",

            "hexagon",

            "plus",

            "cross",

            "bar_vertical",

            "bar_horizontal",

            "chevron",

            "arc"

        ];

        //--------------------------------------------------
        // Construction des trois couronnes
        //--------------------------------------------------

        COURONNES.forEach(couronne => {

            const step = (Math.PI * 2) / couronne.total;

            for (let i = 0; i < couronne.total; i++) {

                let angle = i * step - Math.PI / 2;

                //--------------------------------------------------
                // Cartouche inférieur réservé
                //--------------------------------------------------

                const deg = ((angle * 180 / Math.PI) + 360) % 360;

                if (deg >= 148 && deg <= 212) {
                    continue;
                }

                //--------------------------------------------------
                // Léger décalage organique
                //--------------------------------------------------

                const angleOffset =
                    (nextSeed() - 0.5) * 0.045;

                angle += angleOffset;

                //--------------------------------------------------
                // Rayon variable
                //--------------------------------------------------

                const rayon =
                    couronne.rayon +
                    ((nextSeed() - 0.5) * 7);

                //--------------------------------------------------
                // Forme
                //--------------------------------------------------

                const forme =
                    formes[
                        Math.floor(
                            nextSeed() * formes.length
                        )
                    ];

                //--------------------------------------------------
                // Plein / Vide
                //--------------------------------------------------

                const plein =
                    nextSeed() > 0.42;

                //--------------------------------------------------
                // Rotation propre
                //--------------------------------------------------

                const rotation =
                    angle +
                    (nextSeed() - 0.5) * 0.25;

                //--------------------------------------------------
                // Taille locale
                //--------------------------------------------------

                const scale =
                    0.85 +
                    nextSeed() * 0.45;

                glyphes.push({

                    forme,

                    rayon,

                    angle,

                    rotation,

                    plein,

                    taille: couronne.taille,

                    scale

                });

            }

        });

        //--------------------------------------------------
        // Anneau interne décoratif
        //--------------------------------------------------

        const interne = 56;

        for (let i = 0; i < interne; i++) {

            let angle =
                (i / interne) *
                Math.PI *
                2 -
                Math.PI / 2;

            const deg =
                ((angle * 180 / Math.PI) + 360) % 360;

            if (deg >= 150 && deg <= 210) {
                continue;
            }

            glyphes.push({

                forme:
                    i % 2 === 0
                        ? "circle"
                        : "diamond",

                rayon: 94,

                angle,

                rotation: angle,

                plein: false,

                taille: "micro",

                scale: 0.75

            });

        }

        //--------------------------------------------------
        // Marqueurs cardinaux
        //--------------------------------------------------

        const cardinaux = [

            -90,

            0,

            90,

            180

        ];

        cardinaux.forEach(a => {

            if (a === 180) {
                return;
            }

            glyphes.push({

                forme: "double_circle",

                rayon: 173,

                angle: a * Math.PI / 180,

                rotation: 0,

                plein: true,

                taille: "cardinal",

                scale: 1.25

            });

        });

        //--------------------------------------------------
        // Couronne intérieure de sécurité
        //--------------------------------------------------

        const mini = 40;

        for (let i = 0; i < mini; i++) {

            const angle =
                (i / mini) *
                Math.PI *
                2;

            glyphes.push({

                forme:
                    i % 4 === 0
                        ? "plus"
                        : "circle",

                rayon: 72,

                angle,

                rotation: angle,

                plein: true,

                taille: "micro",

                scale: 0.45

            });

        }

        //--------------------------------------------------
        // Tri final
        //--------------------------------------------------

        glyphes.sort((a, b) => {

            if (a.rayon !== b.rayon)
                return b.rayon - a.rayon;

            return a.angle - b.angle;

        });

        return glyphes;

    }

};

module.exports = Compositeur;