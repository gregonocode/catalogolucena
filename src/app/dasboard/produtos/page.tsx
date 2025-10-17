"use client";

import React from "react";
import { Plus, Loader2, Check, X, Image as ImageIcon, Tag, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const ACCENT = "#01A920";

type Category = { id: string; name: string; slug: string };

type SizeKey = "P" | "M" | "G" | "GG";
const SIZE_LABELS: SizeKey[] = ["P", "M", "G", "GG"];

type ColorDraft = { name: string; hex: string };

type FormState = {
  title: string;
  description: string;
  priceBRL: string;
  active: boolean;
  categoryIds: string[];
  imageFile?: File | null;

  // NOVO: tamanho único + estoque no products.amount
  singleSize: boolean;       // toggle "Este produto é tamanho único?"
  amountStr: string;         // input de estoque (string numérica)

  // Variantes:
  createSizeGroup: boolean;
  sizesToCreate: Record<SizeKey, boolean>;

  createColorGroup: boolean;
  colorDrafts: ColorDraft[];
  colorNameInput: string;
  colorHexInput: string;
};

const isValidHex = (v: string) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);

export default function ProductsPage() {
  const supabase = supabaseBrowser();

  const [submitting, setSubmitting] = React.useState(false);
  const [ok, setOk] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [form, setForm] = React.useState<FormState>({
    title: "",
    description: "",
    priceBRL: "",
    active: true,
    categoryIds: [],
    imageFile: null,

    // NOVO:
    singleSize: false,
    amountStr: "",

    createSizeGroup: false,
    sizesToCreate: { P: false, M: false, G: false, GG: false },

    createColorGroup: false,
    colorDrafts: [],
    colorNameInput: "",
    colorHexInput: "#000000",
  });

  const [categories, setCategories] = React.useState<Category[]>([]);
  const [loadingCats, setLoadingCats] = React.useState(true);

  React.useEffect(() => {
    let ignore = false;
    (async () => {
      setLoadingCats(true);
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, slug")
        .order("created_at", { ascending: false });
      if (!ignore) {
        if (error) {
          console.error(error);
        } else {
          setCategories(data ?? []);
        }
        setLoadingCats(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [supabase]);

  // Helpers
  function onlyDigits(text: string) {
    return Array.from(text)
      .filter((ch) => ch >= "0" && ch <= "9")
      .join("");
  }
  function maskBRL(value: string) {
    const digits = onlyDigits(value);
    const asNumber = Number(digits || "0");
    const cents = asNumber / 100;
    return cents.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function parseBRLToCents(masked: string) {
    const cleaned = masked
      .replace("R$", "")
      .split(" ")
      .join("")
      .split(".")
      .join("")
      .replace(",", ".");
    const num = Number(cleaned || "0");
    return Math.round(num * 100);
  }
  function parseAmountInt(v: string) {
    const digits = onlyDigits(v);
    if (!digits) return 0;
    return Math.max(0, parseInt(digits, 10));
  }

  function validate(): string | null {
    if (!form.title.trim()) return "Informe o nome do produto";
    if (!form.priceBRL.trim()) return "Informe o preço";

    // Se for tamanho único, exigir quantidade (>= 0; aqui exigimos que o usuário preencha explicitamente)
    if (form.singleSize) {
      const amt = form.amountStr.trim();
      if (amt === "") return "Informe a quantidade em estoque para tamanho único";
      const asInt = parseAmountInt(amt);
      if (isNaN(asInt) || asInt < 0) return "Quantidade inválida";
      // Sem variantes nesse modo
      return null;
    }

    // Caso não seja tamanho único, validar variantes escolhidas (se ativadas)
    if (form.createColorGroup) {
      for (const c of form.colorDrafts) {
        if (!c.name.trim()) return "Informe o nome de cada cor adicionada";
        if (!isValidHex(c.hex)) return `Hex inválido em "${c.name}" (${c.hex})`;
      }
    }
    if (form.createSizeGroup) {
      const anySize = SIZE_LABELS.some((s) => form.sizesToCreate[s]);
      if (!anySize) return "Selecione pelo menos um tamanho para criar";
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setOk(null);
    setErr(null);

    try {
      const v = validate();
      if (v) throw new Error(v);

      const price_cents = parseBRLToCents(form.priceBRL);
      const amountToSave = form.singleSize ? parseAmountInt(form.amountStr) : null;

      // 1) Inserir produto (incluindo amount quando tamanho único)
      const { data: product, error: prodErr } = await supabase
        .from("products")
        .insert({
          title: form.title.trim(),
          description: form.description.trim() || null,
          price_cents,
          active: form.active,
          amount: amountToSave, // <<<<<< NOVO
        })
        .select("id")
        .single<{ id: string }>();
      if (prodErr) throw prodErr;
      const productId = product.id;

      // 2) Upload de imagem (opcional)
      if (form.imageFile) {
        const file = form.imageFile;
        const path = `products/${productId}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("produtos")
          .upload(path, file, {
            cacheControl: "3600",
            upsert: true,
            contentType: file.type || undefined,
          });
        if (upErr) throw upErr;

        const { error: imgErr } = await supabase.from("product_images").insert({
          product_id: productId,
          storage_path: path,
          is_primary: true,
        });
        if (imgErr) throw imgErr;
      }

      // 3) Vincular categorias (se houver)
      if (form.categoryIds.length) {
        const payload = form.categoryIds.map((category_id) => ({
          product_id: productId,
          category_id,
        }));
        const { error: pcErr } = await supabase.from("product_categories").insert(payload);
        if (pcErr) throw pcErr;
      }

      // 4) Variantes — SOMENTE se NÃO for tamanho único
      if (!form.singleSize) {
        // 4.1) Grupo Tamanho
        if (form.createSizeGroup) {
          const { data: sizeGroup, error: sizeGroupErr } = await supabase
            .from("variant_groups")
            .insert({ product_id: productId, name: "Tamanho", position: 0 })
            .select("id")
            .single<{ id: string }>();
          if (sizeGroupErr) throw sizeGroupErr;

          const sizeOptions = SIZE_LABELS
            .filter((s) => form.sizesToCreate[s])
            .map((s, idx) => ({
              variant_group_id: sizeGroup.id,
              value: s,
              code: s,
              position: idx,
            }));

          if (sizeOptions.length) {
            const { error: sizeOptsErr } = await supabase.from("variant_options").insert(sizeOptions);
            if (sizeOptsErr) throw sizeOptsErr;
          }
        }

        // 4.2) Grupo Cor
        if (form.createColorGroup) {
          const { data: colorGroup, error: colorGroupErr } = await supabase
            .from("variant_groups")
            .insert({ product_id: productId, name: "Cor", position: 1 })
            .select("id")
            .single<{ id: string }>();
          if (colorGroupErr) throw colorGroupErr;

          const colorOptions = form.colorDrafts.map((c, idx) => ({
            variant_group_id: colorGroup.id,
            value: c.name.trim(),
            code: c.hex.trim(),
            position: idx,
          }));

          if (colorOptions.length) {
            const { error: colorOptsErr } = await supabase.from("variant_options").insert(colorOptions);
            if (colorOptsErr) throw colorOptsErr;
          }
        }
      }

      setOk("Produto criado com sucesso!");
      setForm({
        title: "",
        description: "",
        priceBRL: "",
        active: true,
        categoryIds: [],
        imageFile: null,

        singleSize: false,
        amountStr: "",

        createSizeGroup: false,
        sizesToCreate: { P: false, M: false, G: false, GG: false },

        createColorGroup: false,
        colorDrafts: [],
        colorNameInput: "",
        colorHexInput: "#000000",
      });
    } catch (e: unknown) {
      console.error(e);
      setErr((e as Error)?.message || "Erro ao criar produto");
    } finally {
      setSubmitting(false);
    }
  }

  function onPriceChange(v: string) {
    setForm((f) => ({ ...f, priceBRL: maskBRL(v) }));
  }

  function toggleCategory(id: string) {
    setForm((f) => ({
      ...f,
      categoryIds: f.categoryIds.includes(id)
        ? f.categoryIds.filter((x) => x !== id)
        : [...f.categoryIds, id],
    }));
  }

  // Handlers variantes
  function toggleCreateSizeGroup() {
    setForm((f) => ({ ...f, createSizeGroup: !f.createSizeGroup }));
  }
  function toggleSize(s: SizeKey) {
    setForm((f) => ({ ...f, sizesToCreate: { ...f.sizesToCreate, [s]: !f.sizesToCreate[s] } }));
  }
  function toggleCreateColorGroup() {
    setForm((f) => ({ ...f, createColorGroup: !f.createColorGroup }));
  }
  function addColorDraft() {
    if (!form.colorNameInput.trim()) {
      setErr("Informe o nome da cor");
      return;
    }
    if (!isValidHex(form.colorHexInput)) {
      setErr("Hex da cor inválido (#RGB ou #RRGGBB)");
      return;
    }
    setErr(null);
    setForm((f) => ({
      ...f,
      colorDrafts: [...f.colorDrafts, { name: f.colorNameInput.trim(), hex: f.colorHexInput }],
      colorNameInput: "",
      colorHexInput: "#000000",
    }));
  }
  function removeColorDraft(idx: number) {
    setForm((f) => ({
      ...f,
      colorDrafts: f.colorDrafts.filter((_, i) => i !== idx),
    }));
  }

  // NOVO: toggle tamanho único — ao ativar, ocultamos variantes e limpamos seleções
  function toggleSingleSize() {
    setForm((f) => ({
      ...f,
      singleSize: !f.singleSize,
      // se ativar, desliga variantes e limpa seleções
      createSizeGroup: !f.singleSize ? false : f.createSizeGroup,
      createColorGroup: !f.singleSize ? false : f.createColorGroup,
      sizesToCreate: !f.singleSize ? { P: false, M: false, G: false, GG: false } : f.sizesToCreate,
      // se desativar, mantém amount preenchido para não perder dado; pode limpar se preferir:
      // amountStr: !f.singleSize ? "" : f.amountStr,
    }));
  }

  return (
    <div className="max-w-screen-sm mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Produtos</h1>
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <Tag className="w-4 h-4" /> cadastro conectado
        </span>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm text-gray-700">Nome do produto</label>
          <input
            required
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Ex.: Camiseta Básica Unissex"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-700">Descrição</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Detalhes do produto (tecido, modelagem, etc.)"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-700">Preço</label>
          <input
            required
            inputMode="numeric"
            value={form.priceBRL}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder="R$ 0,00"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
          />
        </div>

        {/* ===== NOVO BLOCO: Tamanho único + estoque ===== */}
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-3 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-700">Este produto é tamanho único?</label>
            <button
              type="button"
              onClick={toggleSingleSize}
              className={`w-12 h-6 rounded-full relative transition-colors ${form.singleSize ? "bg-emerald-500" : "bg-gray-300"}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  form.singleSize ? "translate-x-6" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {form.singleSize && (
            <div className="space-y-1">
              <label className="text-sm text-gray-700">Quantidade em estoque</label>
              <input
                inputMode="numeric"
                value={form.amountStr}
                onChange={(e) => {
                  // apenas dígitos
                  const digits = onlyDigits(e.target.value);
                  setForm((f) => ({ ...f, amountStr: digits }));
                }}
                placeholder="0"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
              />
              <p className="text-xs text-gray-500">
                Produto de tamanho unico. Variantes ficam desativadas nesse modo.
              </p>
            </div>
          )}
        </div>
        {/* ===== FIM TAMANHO ÚNICO ===== */}

        <div className="space-y-1">
          <label className="text-sm text-gray-700">Categorias</label>
          <div className="flex flex-wrap gap-2">
            {loadingCats ? (
              <span className="text-xs text-gray-500">Carregando...</span>
            ) : categories.length ? (
              categories.map((c) => {
                const active = form.categoryIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCategory(c.id)}
                    className={`px-3 py-1.5 rounded-full border text-sm ${
                      active ? "text-white border-transparent" : "text-gray-700 border-gray-200 bg-gray-50"
                    }`}
                    style={active ? { backgroundColor: ACCENT } : {}}
                  >
                    {c.name}
                  </button>
                );
              })
            ) : (
              <span className="text-xs text-gray-500">Nenhuma categoria. Crie em &quot;Categorias&quot;.</span>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-gray-700">Imagem principal</label>
          <label className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-gray-300 cursor-pointer">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setForm((f) => ({ ...f, imageFile: e.target.files?.[0] }))}
            />
            <span className="grid place-items-center w-10 h-10 rounded-lg bg-gray-100 border border-gray-200">
              <ImageIcon className="w-5 h-5 text-gray-600" />
            </span>
            <div className="flex-1">
              <div className="text-sm">Clique para selecionar</div>
              <div className="text-xs text-gray-500">PNG ou JPG até 10MB</div>
            </div>
            {form.imageFile ? (
              <span className="text-xs text-gray-600 truncate max-w-[140px]">{form.imageFile.name}</span>
            ) : null}
          </label>
        </div>

        {/* ===== Variantes (opcional) — oculto quando tamanho único ===== */}
        {!form.singleSize && (
          <div className="space-y-4 rounded-2xl border border-gray-100 bg-white shadow-sm p-3">
            <div className="text-sm font-medium mb-1">Variantes (opcional)</div>

            {/* Tamanho */}
            <div className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-700">Criar grupo &quot;Tamanho&quot;</label>
                <button
                  type="button"
                  onClick={toggleCreateSizeGroup}
                  className={`w-12 h-6 rounded-full relative transition-colors ${
                    form.createSizeGroup ? "bg-emerald-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      form.createSizeGroup ? "translate-x-6" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {form.createSizeGroup && (
                <div className="mt-3">
                  <div className="text-xs text-gray-500 mb-2">Selecione os tamanhos a criar:</div>
                  <div className="flex flex-wrap gap-2">
                    {SIZE_LABELS.map((sz) => {
                      const active = form.sizesToCreate[sz];
                      return (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => toggleSize(sz)}
                          className={`px-3 py-1.5 rounded-full border text-sm ${
                            active ? "text-white border-transparent" : "text-gray-700 border-gray-200 bg-gray-50"
                          }`}
                          style={active ? { backgroundColor: ACCENT } : {}}
                        >
                          {sz}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Cor */}
            <div className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-gray-700">Criar grupo &quot;Cor&quot;</label>
                <button
                  type="button"
                  onClick={toggleCreateColorGroup}
                  className={`w-12 h-6 rounded-full relative transition-colors ${
                    form.createColorGroup ? "bg-emerald-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      form.createColorGroup ? "translate-x-6" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {form.createColorGroup && (
                <div className="mt-3 space-y-3">
                  {/* Linha de adição */}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={form.colorNameInput}
                      onChange={(e) => setForm((f) => ({ ...f, colorNameInput: e.target.value }))}
                      placeholder="Nome da cor (ex.: Preto)"
                      className="flex-1 min-w-40 px-3 py-2 rounded-xl border border-gray-200"
                    />
                    <input
                      type="color"
                      value={isValidHex(form.colorHexInput) ? form.colorHexInput : "#000000"}
                      onChange={(e) => setForm((f) => ({ ...f, colorHexInput: e.target.value }))}
                      className="h-10 w-10 rounded-lg border border-gray-200 bg-white p-1"
                      title="Escolher cor"
                    />
                    <input
                      value={form.colorHexInput}
                      onChange={(e) => setForm((f) => ({ ...f, colorHexInput: e.target.value }))}
                      placeholder="#RRGGBB"
                      className="w-32 px-3 py-2 rounded-xl border border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={addColorDraft}
                      className="px-3 py-2 rounded-xl text-white text-sm"
                      style={{ backgroundColor: ACCENT }}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Lista de cores adicionadas */}
                  {form.colorDrafts.length ? (
                    <ul className="space-y-2">
                      {form.colorDrafts.map((c, idx) => (
                        <li
                          key={`${c.name}-${idx}`}
                          className="flex items-center justify-between p-2 rounded-xl border border-gray-100 bg-gray-50"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block w-5 h-5 rounded-full border"
                              style={{ backgroundColor: c.hex, borderColor: "#e5e7eb" }}
                              title={c.hex}
                            />
                            <span className="text-sm">{c.name}</span>
                            <span className="text-xs text-gray-500">{c.hex}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeColorDraft(idx)}
                            className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white"
                            title="Remover"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-gray-500">Nenhuma cor adicionada.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-700">Ativo</label>
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, active: !f.active }))}
            className={`w-12 h-6 rounded-full relative transition-colors ${form.active ? "bg-emerald-500" : "bg-gray-300"}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                form.active ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white shadow-sm active:scale-[0.99]"
            style={{ backgroundColor: ACCENT }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span>Criar produto</span>
          </button>

          {ok && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-xl">
              <Check className="w-4 h-4" /> {ok}
            </span>
          )}
          {err && (
            <span className="inline-flex items-center gap-1 text-sm text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-xl">
              <X className="w-4 h-4" /> {err}
            </span>
          )}
        </div>
      </form>

      <div className="mt-6 p-3 rounded-xl border border-gray-100 bg-gray-50 text-xs text-gray-600">
        <p className="mb-1 font-medium">Próximos passos:</p>
        <ol className="list-decimal ml-4 space-y-1">
          <li>Na home (src/app/page.tsx), listar products (ativos) e imagem primária.</li>
          <li>Na lista de produtos, exibir Imagem / Produto / Preço / Categorias / Status.</li>
          <li>Implementar edição do produto (update) e upload secundário de imagens.</li>
          <li>(Opcional) Validar tamanho/tipo da imagem antes do upload.</li>
          <li>Gestão de estoque pode ser por <b>tamanho único (products.amount)</b> ou por <b>variantes</b>.</li>
        </ol>
      </div>
    </div>
  );
}
