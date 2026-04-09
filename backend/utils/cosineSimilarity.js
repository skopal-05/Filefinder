const dotProduct = (left, right) => {
  let total = 0;

  for (let index = 0; index < left.length; index += 1) {
    total += left[index] * right[index];
  }

  return total;
};

const magnitude = (vector) => Math.sqrt(dotProduct(vector, vector));

const cosineSimilarity = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) {
    return 0;
  }

  const denominator = magnitude(left) * magnitude(right);

  if (!denominator) {
    return 0;
  }

  return dotProduct(left, right) / denominator;
};

module.exports = cosineSimilarity;
