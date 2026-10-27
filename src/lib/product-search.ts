export function searchTokens(query: string) {
  return [...new Set(query.slice(0, 100).trim().split(/\s+/).filter(Boolean))].slice(0, 15);
}
export function matchesProduct(product: { name: string; barcode: string }, query: string) {
  const fields = [product.name.toLocaleLowerCase('es'), product.barcode.toLocaleLowerCase('es')];
  return searchTokens(query).every((token) =>
    fields.some((field) => field.includes(token.toLocaleLowerCase('es'))),
  );
}
export const escapeLike = (token: string) => token.replace(/[\\%_]/g, '\\$&');
