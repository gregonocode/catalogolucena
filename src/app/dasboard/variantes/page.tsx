"use client";

import React from "react";
import {
  Layers3,
  Plus,
  Loader2,
  Check,
  X,
  Pencil,
  Trash2,
  GripVertical,
  Shirt,
  Package2,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const ACCENT = "#01A920";

type Product = { id: string; title: string };
type VariantGroup = { id: string; product_id: string; name: string; position: number };
type VariantGroupEditable = VariantGroup & { _editing?: boolean };
type VariantOption = { id: string; variant_group_id: string; value: string; code: string | null; position: number };

type SizeKey = "P" | "M" | "G" | "GG";
const SIZE_LABELS: SizeKey[] = ["P", "M", "G", "GG"];

export default function VariantsPage() {
  const supabase = supabaseBrowser();

  const [products, setProducts] = React.useState<Product[]>([]);
  const [productId, setProductId] = React.useState<string>("");
  const [loadingProducts, setLoadingProducts] = React.useState(true);

  const [groups, setGroups] = React.useState<VariantGroupEditable[]>([]);
  const [options, setOptions] = React.useState<VariantOption[]>([]);
  const [loadingData, setLoadingData] = React.useState(false);

  const [err, setErr] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  // Estado de tamanhos/estoque
  const [sizeGroupId, setSizeGroupId] = React.useState<string | null>(null);
  const [sizeOptionIds, setSizeOptionIds] = React.useState<Record<SizeKey, string | null>>({
    P: null,
    M: null,
    G: null,
    GG: null,
  });
  const [sizesSelected, setSizesSelected] = React.useState<Record<SizeKey, boolean>>({
    P: false,
    M: false,
    G: false,
    GG: false,
  });
  const [sizesAmount, setSizesAmount] = React.useState<Record<SizeKey, number>>({
    P: 0,
    M: 0,
    G: 0,
    GG: 0,
  });
  const [loadingSizes, setLoadingSizes] = React.useState(false);

  // Inline edit por tamanho (grupo Tamanho)
  const [editing, setEditing] = React.useState<Record<SizeKey, boolean>>({
    P: false,
    M: false,
    G: false,
    GG: false,
  });
  const [savingOne, setSavingOne] = React.useState<SizeKey | null>(null);

  // ---------------- Helpers base (carregar dados) ----------------
  async function reloadFor(
    pid: string,
    sb = supabase,
    setG: React.Dispatch<React.SetStateAction<VariantGroupEditable[]>> = setGroups,
    setO: React.Dispatch<React.SetStateAction<VariantOption[]>> = setOptions,
    setL: React.Dispatch<React.SetStateAction<boolean>> = setLoadingData,
    setE: React.Dispatch<React.SetStateAction<string | null>> = setErr
  ): Promise<{ groups: VariantGroupEditable[]; options: VariantOption[] }> {
    if (!pid) {
      setG([]);
      setO([]);
      return { groups: [], options: [] };
    }
    setL(true);
    setE(null);

    const { data: gdata, error: gerr } = await sb
      .from("variant_groups")
      .select("id, product_id, name, position")
      .eq("product_id", pid)
      .order("position", { ascending: true })
      .order("id", { ascending: true });

    if (gerr) {
      setE(gerr.message);
      setL(false);
      return { groups: [], options: [] };
    }

    const groupIds = (gdata ?? []).map((g) => g.id);

    let odata: VariantOption[] = [];
    if (groupIds.length) {
      const { data: o, error: oerr } = await sb
        .from("variant_options")
        .select("id, variant_group_id, value, code, position")
        .in("variant_group_id", groupIds)
        .order("position", { ascending: true })
        .order("id", { ascending: true });
      if (oerr) {
        setE(oerr.message);
        setL(false);
        return { groups: (gdata ?? []) as VariantGroupEditable[], options: [] };
      }
      odata = (o ?? []) as VariantOption[];
    }

    const gArr = (gdata ?? []) as VariantGroupEditable[];
    const oArr = odata;

    setG(gArr);
    setO(oArr);
    setL(false);

    return { groups: gArr, options: oArr };
  }

  React.useEffect(() => {
    let ignore = false;
    (async () => {
      setLoadingProducts(true);
      const { data, error } = await supabase
        .from("products")
        .select("id, title")
        .order("created_at", { ascending: false });
      if (!ignore) {
        if (error) {
          console.error(error);
          setErr(error.message);
        } else {
          const arr = (data ?? []) as Product[];
          setProducts(arr);
          const first = arr[0]?.id ?? "";
          setProductId(first);
          if (first) {
            const fresh = await reloadFor(first);
            await loadSizeStockForProduct(first, fresh.groups, fresh.options);
          }
        }
        setLoadingProducts(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [supabase]);

  React.useEffect(() => {
    if (productId) {
      (async () => {
        const fresh = await reloadFor(productId);
        await loadSizeStockForProduct(productId, fresh.groups, fresh.options);
      })();
    } else {
      setGroups([]);
      setOptions([]);
      resetSizesUI();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const productGroups = React.useMemo(
    () => groups.filter((g) => g.product_id === productId).sort((a, b) => a.position - b.position),
    [groups, productId]
  );

  function nextGroupPosition(): number {
    return productGroups.length ? Math.max(...productGroups.map((g) => g.position)) + 1 : 0;
  }

  // ---------------- Tamanhos: carregar/garantir ----------------
  function resetSizesUI() {
    setSizeGroupId(null);
    setSizeOptionIds({ P: null, M: null, G: null, GG: null });
    setSizesSelected({ P: false, M: false, G: false, GG: false });
    setSizesAmount({ P: 0, M: 0, G: 0, GG: 0 });
    setEditing({ P: false, M: false, G: false, GG: false });
    setSavingOne(null);
  }

  async function loadSizeStockForProduct(
    pid: string,
    groupsArg?: VariantGroupEditable[],
    optionsArg?: VariantOption[]
  ) {
    resetSizesUI();
    if (!pid) return;

    setLoadingSizes(true);
    setErr(null);

    try {
      const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

      // use dados frescos se fornecidos; caso contrário, caia para o state
      const gList = groupsArg ?? productGroups;
      const oList = optionsArg ?? options;

      // localizar grupo "Tamanho"
      const sizeGroup = gList.find((g) => norm(g.name) === "tamanho") ?? null;
      setSizeGroupId(sizeGroup?.id ?? null);

      // localizar opções P/M/G/GG
      const idMap: Record<SizeKey, string | null> = { P: null, M: null, G: null, GG: null };
      if (sizeGroup) {
        const szOpts = oList
          .filter((o) => o.variant_group_id === sizeGroup.id)
          .filter((o) => SIZE_LABELS.includes(o.value as SizeKey));
        for (const key of SIZE_LABELS) {
          const opt = szOpts.find((o) => o.value === key);
          idMap[key] = opt?.id ?? null;
        }
      }
      setSizeOptionIds(idMap);

      // buscar quantidades salvas
      const idsToLoad = Object.values(idMap).filter(Boolean) as string[];

      let pvArr: { variant_option_id: string; amount: number }[] = [];
      if (idsToLoad.length) {
        const { data: pvRows } = await supabase
          .from("product_variants")
          .select("variant_option_id, amount")
          .eq("product_id", pid)
          .in("variant_option_id", idsToLoad);
        pvArr = (pvRows ?? []) as { variant_option_id: string; amount: number }[];
      }

      // chip ativo se existe option; amount visível (0 se não houver linha)
      const amt: Record<SizeKey, number> = { P: 0, M: 0, G: 0, GG: 0 };
      const sel: Record<SizeKey, boolean> = { P: false, M: false, G: false, GG: false };
      for (const key of SIZE_LABELS) {
        const vid = idMap[key];
        if (vid) {
          sel[key] = true;
          const found = pvArr.find((r) => r.variant_option_id === vid);
          amt[key] = Number.isFinite(found?.amount as number) ? (found!.amount as number) : 0;
        }
      }
      setSizesAmount(amt);
      setSizesSelected(sel);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao carregar tamanhos";
      setErr(msg);
    } finally {
      setLoadingSizes(false);
    }
  }

  async function ensureSizeGroup(): Promise<string> {
    const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const existing = productGroups.find((g) => norm(g.name) === "tamanho");
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from("variant_groups")
      .insert({ product_id: productId, name: "Tamanho", position: nextGroupPosition() })
      .select("id, product_id, name, position")
      .single<VariantGroup>();
    if (error) throw error;

    const fresh = await reloadFor(productId);
    setSizeGroupId(data.id);
    // manter estado em sincronia
    await loadSizeStockForProduct(productId, fresh.groups, fresh.options);
    return data.id;
  }

  async function ensureOneSizeOption(gid: string, size: SizeKey): Promise<string> {
    const existing = options.find((o) => o.variant_group_id === gid && o.value === size);
    if (existing) return existing.id;

    const positionBase = options.filter((o) => o.variant_group_id === gid).length;
    const { data, error } = await supabase
      .from("variant_options")
      .insert({ variant_group_id: gid, value: size, code: size, position: positionBase })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;

    const fresh = await reloadFor(productId);
    await loadSizeStockForProduct(productId, fresh.groups, fresh.options);
    return data.id;
  }

  // Toggle inline (cria/remove imediatamente)
  async function toggleSize(size: SizeKey) {
    if (!productId) return;
    setErr(null);
    setOk(null);

    try {
      const turningOn = !sizesSelected[size];

      if (turningOn) {
        // cria grupo (se faltar) e option para esse tamanho
        const gid = await ensureSizeGroup();
        const optId = await ensureOneSizeOption(gid, size);

        // upsert product_variants com quantidade atual (ou 0)
        const amount = Math.max(0, Math.trunc(Number(sizesAmount[size] ?? 0)));
        const { error: upErr } = await supabase
          .from("product_variants")
          .upsert({ product_id: productId, variant_option_id: optId, amount }, { onConflict: "product_id,variant_option_id" });
        if (upErr) throw upErr;

        // atualizar estados locais (imediato)
        setSizesSelected((p) => ({ ...p, [size]: true }));
        setSizeOptionIds((p) => ({ ...p, [size]: optId }));

        setOk(`Tamanho ${size} criado.`);
      } else {
        // desativar: remover product_variants + variant_option
        const optId = sizeOptionIds[size];
        if (optId) {
          const { error: delPvErr } = await supabase
            .from("product_variants")
            .delete()
            .eq("product_id", productId)
            .eq("variant_option_id", optId);
          if (delPvErr) throw delPvErr;

          const { error: delOptErr } = await supabase.from("variant_options").delete().eq("id", optId);
          if (delOptErr) throw delOptErr;
        }

        setSizesSelected((p) => ({ ...p, [size]: false }));
        setSizesAmount((p) => ({ ...p, [size]: 0 }));
        setSizeOptionIds((p) => ({ ...p, [size]: null }));

        // recarrega e aplica na UI usando dados frescos
        await reloadFor(productId).then(({ groups: gArr, options: oArr }) =>
          loadSizeStockForProduct(productId, gArr, oArr)
        );

        setOk(`Tamanho ${size} removido.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao alternar tamanho");
    }
  }

  // Salvar apenas 1 quantidade (inline)
  async function saveSingleSize(size: SizeKey) {
    if (!productId) return;
    const optId = sizeOptionIds[size];
    if (!optId) return;

    setSavingOne(size);
    setErr(null);
    setOk(null);

    try {
      const amount = Math.max(0, Math.trunc(Number(sizesAmount[size] ?? 0)));
      const row = { product_id: productId, variant_option_id: optId, amount };

      const { error: upErr } = await supabase
        .from("product_variants")
        .upsert(row, { onConflict: "product_id,variant_option_id" });
      if (upErr) throw upErr;

      setEditing((prev) => ({ ...prev, [size]: false }));
      setOk(`Estoque de ${size} atualizado.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao salvar quantidade";
      setErr(msg);
    } finally {
      setSavingOne(null);
    }
  }

  // ---------------- CRUD básico de grupos/opções (outros grupos) ----------------
  function startEditGroup(id: string) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, _editing: true } : g)));
  }
  function cancelEditGroup(id: string) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, _editing: false } : g)));
  }
  async function saveEditGroup(id: string, name: string) {
    try {
      const { data, error } = await supabase
        .from("variant_groups")
        .update({ name: name.trim() })
        .eq("id", id)
        .select("id, product_id, name, position")
        .single<VariantGroup>();
      if (error) throw error;
      setGroups((prev) => prev.map((g) => (g.id === id ? { ...data, _editing: false } : g)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar grupo");
    }
  }
  async function removeGroup(id: string) {
    if (!confirm("Remover grupo e suas opções?")) return;
    try {
      const { error } = await supabase.from("variant_groups").delete().eq("id", id);
      if (error) throw error;
      setGroups((prev) => prev.filter((g) => g.id !== id));
      const fresh = await reloadFor(productId);
      if (id === sizeGroupId) resetSizesUI();
      await loadSizeStockForProduct(productId, fresh.groups, fresh.options);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao remover grupo");
    }
  }
  async function addOption(groupId: string, value: string, code?: string) {
    if (!value.trim()) return;
    try {
      const count = options.filter((o) => o.variant_group_id === groupId).length;
      const { error } = await supabase.from("variant_options").insert({
        variant_group_id: groupId,
        value: value.trim(),
        code: code || null,
        position: count,
      });
      if (error) throw error;

      await reloadFor(productId).then(({ groups: gArr, options: oArr }) =>
        loadSizeStockForProduct(productId, gArr, oArr)
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao adicionar opção");
    }
  }
  async function saveOption(optId: string, payload: Partial<VariantOption>) {
    try {
      const { error } = await supabase
        .from("variant_options")
        .update({ value: payload.value?.trim(), code: payload.code ?? null })
        .eq("id", optId);
      if (error) throw error;

      await reloadFor(productId).then(({ groups: gArr, options: oArr }) =>
        loadSizeStockForProduct(productId, gArr, oArr)
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar opção");
    }
  }
  async function deleteOption(optId: string) {
    if (!confirm("Remover opção?")) return;
    try {
      const { error } = await supabase.from("variant_options").delete().eq("id", optId);
      if (error) throw error;

      await reloadFor(productId).then(({ groups: gArr, options: oArr }) =>
        loadSizeStockForProduct(productId, gArr, oArr)
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao remover opção");
    }
  }

  // ---------------- UI ----------------
  return (
    <div className="max-w-screen-sm mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Variantes</h1>
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <Layers3 className="w-4 h-4" /> Tamanho (P, M, G, GG)
        </span>
      </div>

      {/* Produto */}
      <div className="mb-4">
        <label className="text-sm text-gray-700">Produto</label>
        <div className="mt-1 relative">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white"
            disabled={loadingProducts}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400">
            <Shirt className="w-4 h-4" />
          </span>
        </div>
      </div>

      {/* CARD — Chips criam/removem na hora */}
      <section className="mb-6 rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <header className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center w-7 h-7 rounded-md bg-gray-100 border border-gray-200">
              <Package2 className="w-4 h-4 text-gray-600" />
            </span>
            <h2 className="text-sm font-medium">Selecionar tamanhos</h2>
          </div>
        </header>

        <div className="p-3">
          {loadingSizes ? (
            <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">
              Carregando tamanhos...
            </div>
          ) : (
            <>
              <div className="mb-2 text-xs text-gray-500">
                Clique no tamanho para <b>criar/remover</b>. Edite a <b>quantidade</b> na lista do grupo <b>Tamanho</b> abaixo.
              </div>
              <div className="flex flex-wrap gap-2">
                {SIZE_LABELS.map((sz) => {
                  const active = sizesSelected[sz];
                  return (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => toggleSize(sz)}
                      className={`px-3 py-1.5 rounded-full border text-sm transition ${
                        active ? "text-white border-transparent" : "text-gray-700 border-gray-200 bg-gray-50"
                      }`}
                      style={active ? { backgroundColor: ACCENT } : {}}
                      title={active ? "Remover tamanho" : "Criar tamanho"}
                    >
                      {sz}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </section>

      {/* Lista de grupos/opções existentes */}
      {loadingData ? (
        <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">Carregando...</div>
      ) : (
        <div className="space-y-3">
          {productGroups.length === 0 ? (
            <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">
              Nenhum grupo criado.
            </div>
          ) : null}

          {productGroups.map((g) => (
            <section key={g.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <header className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="grid place-items-center w-7 h-7 rounded-md bg-gray-100 border border-gray-200">
                    <GripVertical className="w-4 h-4 text-gray-600" />
                  </span>
                  {g._editing ? (
                    <GroupEditInline
                      name={g.name}
                      onCancel={() => cancelEditGroup(g.id)}
                      onSave={(name) => saveEditGroup(g.id, name)}
                    />
                  ) : (
                    <h2 className="text-sm font-medium">{g.name}</h2>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {g._editing ? null : (
                    <button
                      onClick={() => startEditGroup(g.id)}
                      className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => removeGroup(g.id)}
                    className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </header>

              <OptionsList
                groupId={g.id}
                isSizeGroup={g.id === sizeGroupId}
                options={options
                  .filter((o) => o.variant_group_id === g.id)
                  .sort((a, b) => a.position - b.position)}
                onAdd={addOption}
                onSave={saveOption}
                onDelete={deleteOption}
                amountBySize={sizesAmount}
                onAmountChange={(sz, val) =>
                  setSizesAmount((prev) => ({ ...prev, [sz]: Math.max(0, Math.trunc(val)) }))
                }
                editingBySize={editing}
                onStartEditSize={(sz) => setEditing((prev) => ({ ...prev, [sz]: true }))}
                onSaveSingleSize={saveSingleSize}
                savingOne={savingOne}
              />
            </section>
          ))}
        </div>
      )}

      {(ok || err) && (
        <div className="mt-4 text-sm">
          {ok && <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700">{ok}</div>}
          {err && <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 mt-2">{err}</div>}
        </div>
      )}
    </div>
  );
}

function GroupEditInline({
  name,
  onCancel,
  onSave,
}: {
  name: string;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [v, setV] = React.useState<string>(name);
  const [saving, setSaving] = React.useState<boolean>(false);

  async function handleSave() {
    if (!v.trim()) return;
    setSaving(true);
    try {
      await onSave(v.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} className="px-2 py-1 rounded-lg border border-gray-200 text-sm" />
      <button onClick={handleSave} className="px-2 py-1 rounded-lg text-white text-xs" style={{ backgroundColor: ACCENT }}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      </button>
      <button onClick={onCancel} className="px-2 py-1 rounded-lg border border-gray-200 text-xs">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function OptionsList({
  groupId,
  isSizeGroup,
  options,
  onAdd,
  onSave,
  onDelete,
  amountBySize,
  onAmountChange,
  editingBySize,
  onStartEditSize,
  onSaveSingleSize,
  savingOne,
}: {
  groupId: string;
  isSizeGroup: boolean;
  options: VariantOption[];
  onAdd: (groupId: string, value: string, code?: string) => void;
  onSave: (optId: string, payload: Partial<VariantOption>) => void;
  onDelete: (optId: string) => void;

  amountBySize: Record<SizeKey, number>;
  onAmountChange: (sz: SizeKey, val: number) => void;
  editingBySize: Record<SizeKey, boolean>;
  onStartEditSize: (sz: SizeKey) => void;
  onSaveSingleSize: (sz: SizeKey) => void;
  savingOne: SizeKey | null;
}) {
  const [value, setValue] = React.useState<string>("");
  const [code, setCode] = React.useState<string>("");

  function toSizeKey(v: string): SizeKey | null {
    if (v === "P" || v === "M" || v === "G" || v === "GG") return v;
    return null;
  }

  return (
    <div className="p-3">
      {/* Form inline para criar opção (mantido p/ outros grupos) */}
      <div className="flex items-center gap-2 mb-3">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Opção (ex.: Vermelho)"
          className="flex-1 px-3 py-2 rounded-xl border border-gray-200"
        />
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Código (opcional)"
          className="w-40 px-3 py-2 rounded-xl border border-gray-200"
        />
        <button
          onClick={() => {
            onAdd(groupId, value, code);
            setValue("");
            setCode("");
          }}
          className="px-3 py-2 rounded-xl text-white text-sm"
          style={{ backgroundColor: ACCENT }}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Lista de opções do grupo */}
      <ul className="space-y-2">
        {options.map((o) => {
          const sz = isSizeGroup ? toSizeKey(o.value) : null;
          const isEditableSize = Boolean(isSizeGroup && sz);

          return (
            <li key={o.id} className="flex items-center justify-between p-2 rounded-xl border border-gray-100 bg-gray-50">
              {/* Esquerda: editar nome/código da opção */}
              <div className="flex items-center gap-2">
                <span className="grid place-items-center w-7 h-7 rounded-md bg-white border border-gray-200">
                  <GripVertical className="w-4 h-4 text-gray-600" />
                </span>
                <OptionInline opt={o} onSave={onSave} />
              </div>

              {/* Meio: QTD inline SEMPRE visível (P/M/G/GG) com label */}
              {isEditableSize ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">Qtd:</span>
                  {editingBySize[sz!] ? (
                    <>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={Number.isFinite(amountBySize[sz!]) ? amountBySize[sz!] : 0}
                        onChange={(e) => {
                          const n = Math.trunc(Number(e.target.value));
                          onAmountChange(sz!, Number.isNaN(n) ? 0 : n);
                        }}
                        className="w-24 px-3 py-1.5 rounded-lg border border-gray-200 bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => onSaveSingleSize(sz!)}
                        disabled={savingOne === sz}
                        className="px-2 py-1 rounded-lg text-white text-xs"
                        style={{ backgroundColor: ACCENT }}
                        title="Salvar quantidade"
                      >
                        {savingOne === sz ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onStartEditSize(sz!)}
                      className="text-sm font-semibold tabular-nums px-2 py-1 rounded-md border border-transparent hover:border-gray-200 bg-white"
                      title="Clique para editar a quantidade"
                    >
                      {Number.isFinite(amountBySize[sz!]) ? amountBySize[sz!] : 0}
                    </button>
                  )}
                </div>
              ) : (
                <div />
              )}

              {/* Direita: Lixeira — OCULTA no grupo Tamanho */}
              {isEditableSize ? (
                <div className="w-4 h-4" /> // placeholder para manter alinhamento
              ) : (
                <button
                  onClick={() => onDelete(o.id)}
                  className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white"
                  title="Excluir opção"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OptionInline({
  opt,
  onSave,
}: {
  opt: VariantOption;
  onSave: (optId: string, payload: Partial<VariantOption>) => void;
}) {
  const [v, setV] = React.useState<string>(opt.value);
  const [c, setC] = React.useState<string>(opt.code || "");
  const [saving, setSaving] = React.useState<boolean>(false);

  async function handleSave() {
    if (!v.trim()) return;
    setSaving(true);
    try {
      await onSave(opt.id, { value: v.trim(), code: c.trim() || null });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input value={v} onChange={(e) => setV(e.target.value)} className="px-2 py-1 rounded-lg border border-gray-200 text-sm" />
      <input value={c} onChange={(e) => setC(e.target.value)} className="w-28 px-2 py-1 rounded-lg border border-gray-200 text-sm" />
      <button onClick={handleSave} className="px-2 py-1 rounded-lg text-white text-xs" style={{ backgroundColor: ACCENT }}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      </button>
    </div>
  );
}
