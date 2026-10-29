export async function paginate(model, filter, { page, limit }, { sort = { created_at: -1, _id: -1 }, populate } = {}) {
  let query = model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).maxTimeMS(5000);
  if (populate) query = query.populate(populate);
  const [data, total] = await Promise.all([query, model.countDocuments(filter).maxTimeMS(5000)]);
  return { data, total, page, totalPages: Math.ceil(total / limit), count: data.length };
}
