function Parse (data) {
  if (!(this instanceof Parse)) {
    return new Parse(data);
  }

  this.error = null;
  this.value = null;

  try {
    this.value = JSON.parse(data);
  } catch (error) {
    this.error = error;
  }
}

export default class Decoder {

  static decode (msg) {
    return Parse(msg);
  }
}
