var stream = require('stream');
var util = require('util');

// node v0.10+ use native Transform, else polyfill
var Transform = stream.Transform;

function VoiceAudioTransform(options) {
    // allow use without new
    if (!(this instanceof VoiceAudioTransform)) {
        return new VoiceAudioTransform(options);
    }

    // init Transform
    Transform.call(this, options);
}
util.inherits(VoiceAudioTransform, Transform);

VoiceAudioTransform.prototype._transform = function (chunk, enc, cb) {
    let VoiceAudioTransformChunk = chunk[1];
    if(chunk[2] != null)
        this.push(VoiceAudioTransformChunk);
    cb();
};
module.exports = VoiceAudioTransform;