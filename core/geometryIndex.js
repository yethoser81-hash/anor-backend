// ==========================================
// ANOR V16 • Moteur GeometryIndex
// ==========================================
const crypto = require('crypto');

const GeometryIndex = {
    build(glyphes) {
        const rawString = glyphes.map(g => `${g.forme}:${g.rayon.toFixed(1)}:${g.angle.toFixed(2)}:${g.plein}`).join('|');
        const sha256 = crypto.createHash('sha256').update(rawString).digest('hex');
        
        return {
            total_glyphes: glyphes.length,
            sha256,
            raw_signature: rawString.substring(0, 64)
        };
    }
};

module.exports = GeometryIndex;