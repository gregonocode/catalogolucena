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
  Droplet,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { VariantMatrix } from "./VariantMatrix"; // ajuste o path se necessário

const ACCENT = "#01A920";

type Product = { id: string; title: string };
type VariantGroup = { id: string; product_id: string; name: string; position: number };
type VariantGroupEditable = VariantGroup & { _editing?: boolean };
type VariantOption = { id: string; variant_group_id: string; value: string; code: string | null; position: number };
type PVRow = { variant_option_id: string; amount: number | null };

type SizeKey = "P" | "M" | "G" | "GG";
const SIZE_LABELS: SizeKey[] = ["P", "M", "G", "GG"];

// Helpers
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const isSizeName = (name: string) => norm(name) === "tamanho";
const isColorName = (name: string) => norm(name) === "cor";
const isValidHex = (v: string) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);

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
  const [warn, setWarn] = React.useState<string | null>(null);

  // Estado de tamanhos/estoque (modo antigo por tamanho)
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

  // --- Retrátil por grupo (persistido por produto) ---
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  function loadCollapsed(pid: string) {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(`vx-collapsed:${pid}`) : null;
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  }
  function saveCollapsed(pid: string, map: Record<string, boolean>) {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(`vx-collapsed:${pid}`, JSON.stringify(map));
      }
    } catch {}
  }
  React.useEffect(() => {
    if (!productId) return;
    setCollapsed(loadCollapsed(productId));
  }, [productId]);

  function toggleGroupCollapse(id: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveCollapsed(productId, next);
      return next;
    });
  }

  // --- Forçar refresh da Grade (VariantMatrix) ---
  const [matrixRefresh, setMatrixRefresh] = React.useState(0);
  const bumpMatrix = React.useCallback(() => setMatrixRefresh((v) => v + 1), []);

  // ---------------- Helpers base (carregar dados) ----------------
  const reloadFor = React.useCallback(
    async (
      pid: string,
      sb = supabase,
      setG: React.Dispatch<React.SetStateAction<VariantGroupEditable[]>> = setGroups,
      setO: React.Dispatch<React.SetStateAction<VariantOption[]>> = setOptions,
      setL: React.Dispatch<React.SetStateAction<boolean>> = setLoadingData,
      setE: React.Dispatch<React.SetStateAction<string | null>> = setErr
    ): Promise<{ groups: VariantGroupEditable[]; options: VariantOption[] }> => {
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
    },
    [supabase]
  );

  function resetSizesUI() {
    setSizeGroupId(null);
    setSizeOptionIds({ P: null, M: null, G: null, GG: null });
    setSizesSelected({ P: false, M: false, G: false, GG: false });
    setSizesAmount({ P: 0, M: 0, G: 0, GG: 0 });
    setEditing({ P: false, M: false, G: false, GG: false });
    setSavingOne(null);
  }

  const productGroups = React.useMemo(
    () => groups.filter((g) => g.product_id === productId).sort((a, b) => a.position - b.position),
    [groups, productId]
  );

  const loadSizeStockForProduct = React.useCallback(
    async (
      pid: string,
      groupsArg?: VariantGroupEditable[],
      optionsArg?: VariantOption[]
    ) => {
      resetSizesUI();
      if (!pid) return;

      setLoadingSizes(true);
      setErr(null);

      try {
        const gList = groupsArg ?? productGroups;
        const oList = optionsArg ?? options;

        const sizeGroup = gList.find((g) => isSizeName(g.name)) ?? null;
        setSizeGroupId(sizeGroup?.id ?? null);

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

        const idsToLoad = Object.values(idMap).filter(Boolean) as string[];

        let pvArr: PVRow[] = [];
        if (idsToLoad.length) {
          const { data: pvRows } = await supabase
            .from("product_variants")
            .select("variant_option_id, amount")
            .eq("product_id", pid)
            .in("variant_option_id", idsToLoad);
          pvArr = (pvRows ?? []) as PVRow[];
        }

        const amt: Record<SizeKey, number> = { P: 0, M: 0, G: 0, GG: 0 };
        const sel: Record<SizeKey, boolean> = { P: false, M: false, G: false, GG: false };
        for (const key of SIZE_LABELS) {
          const vid = idMap[key];
          if (vid) {
            sel[key] = true;
            const found = pvArr.find((r) => r.variant_option_id === vid);
            const foundAmount = Number(found?.amount ?? 0);
            amt[key] = Number.isFinite(foundAmount) ? foundAmount : 0;
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
    },
    [supabase, productGroups, options]
  );

  // Carregar lista de produtos + primeiro produto
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
  }, [supabase, reloadFor, loadSizeStockForProduct]);

  // Recarregar grupos/opções ao trocar de produto
  React.useEffect(() => {
    if (productId) {
      (async () => {
        const fresh = await reloadFor(productId);
        await loadSizeStockForProduct(productId, fresh.groups, fresh.options);
        setWarn(null);
        bumpMatrix(); // recarrega Grade ao trocar de produto
      })();
    } else {
      setGroups([]);
      setOptions([]);
      resetSizesUI();
    }
  }, [productId, reloadFor, loadSizeStockForProduct, bumpMatrix]);

  // Se existir grupo "Cor", vamos esconder o editor de Qtd do grupo Tamanho
  const hasColorGroup = React.useMemo(
    () => productGroups.some((g) => isColorName(g.name)),
    [productGroups]
  );

  function nextGroupPosition(): number {
    return productGroups.length ? Math.max(...productGroups.map((g) => g.position)) + 1 : 0;
  }

  // ---------------- Tamanhos: ensure/toggle/save ----------------
  async function ensureSizeGroup(): Promise<string> {
    const existing = productGroups.find((g) => isSizeName(g.name));
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from("variant_groups")
      .insert({ product_id: productId, name: "Tamanho", position: nextGroupPosition() })
      .select("id, product_id, name, position")
      .single<VariantGroup>();
    if (error) throw error;

    const fresh = await reloadFor(productId);
    setSizeGroupId(data.id);
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

  async function toggleSize(size: SizeKey) {
    if (!productId) return;
    setErr(null);
    setOk(null);

    try {
      const turningOn = !sizesSelected[size];

      if (turningOn) {
        const gid = await ensureSizeGroup();
        const optId = await ensureOneSizeOption(gid, size);

        const amount = Math.max(0, Math.trunc(Number(sizesAmount[size] ?? 0)));
        const { error: upErr } = await supabase
          .from("product_variants")
          .upsert({ product_id: productId, variant_option_id: optId, amount }, { onConflict: "product_id,variant_option_id" });
        if (upErr) throw upErr;

        setSizesSelected((p) => ({ ...p, [size]: true }));
        setSizeOptionIds((p) => ({ ...p, [size]: optId }));

        setOk(`Tamanho ${size} criado.`);
      } else {
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

        await reloadFor(productId).then(({ groups: gArr, options: oArr }) =>
          loadSizeStockForProduct(productId, gArr, oArr)
        );

        setOk(`Tamanho ${size} removido.`);
      }

      if (hasColorGroup) bumpMatrix();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao alternar tamanho");
    }
  }

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

      if (hasColorGroup) bumpMatrix();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao salvar quantidade";
      setErr(msg);
    } finally {
      setSavingOne(null);
    }
  }

  // ---------------- COR: ativar grupo + migração opcional ----------------
  async function ensureColorGroup(): Promise<string> {
    const existing = productGroups.find((g) => isColorName(g.name));
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from("variant_groups")
      .insert({ product_id: productId, name: "Cor", position: nextGroupPosition() })
      .select("id, product_id, name, position")
      .single<VariantGroup>();
    if (error) throw error;

    const fresh = await reloadFor(productId);
    const found = fresh.groups.find((g) => isColorName(g.name));
    if (data?.id) return data.id;
    if (found?.id) return found.id;

    throw new Error("Falha ao obter ID do grupo de Cor.");
  }

  async function createColorOption(colorGroupId: string, name: string, hex: string) {
    const count = options.filter((o) => o.variant_group_id === colorGroupId).length;
    const { data, error } = await supabase
      .from("variant_options")
      .insert({
        variant_group_id: colorGroupId,
        value: name.trim(),
        code: hex.trim(),
        position: count,
      })
      .select("id")
      .single<{ id: string }>();
    if (error) throw error;
    return data.id;
  }

  async function migrateSizeStockToSets(targetColorOptId: string) {
    const szMapEntries = Object.entries(sizeOptionIds).filter(([, v]) => v) as [SizeKey, string][];
    if (szMapEntries.length === 0) {
      setWarn("Nenhum tamanho encontrado para migrar.");
      return;
    }
    const { data: pvRows, error: pvErr } = await supabase
      .from("product_variants")
      .select("variant_option_id, amount")
      .eq("product_id", productId)
      .in(
        "variant_option_id",
        szMapEntries.map(([, id]) => id)
      );
    if (pvErr) throw pvErr;

    const byOption = new Map<string, number>();
    const rowsTyped: PVRow[] = (pvRows ?? []) as PVRow[];
    rowsTyped.forEach((r) => {
      byOption.set(r.variant_option_id, Number(r.amount ?? 0));
    });

    for (const [, sizeOptId] of szMapEntries) {
      const amt = byOption.get(sizeOptId) ?? 0;
      if (amt <= 0) continue;

      const { data: setRow, error: setErr } = await supabase
        .from("product_variant_sets")
        .insert({ product_id: productId, amount: amt })
        .select("id")
        .single<{ id: string }>();
      if (setErr) throw setErr;

      const setId = setRow.id;

      const { error: linkErr } = await supabase
        .from("product_variant_set_options")
        .insert([
          { product_variant_set_id: setId, variant_option_id: sizeOptId },
          { product_variant_set_id: setId, variant_option_id: targetColorOptId },
        ]);
      if (linkErr) throw linkErr;
    }

    // zera product_variants para não somar em dobro
    const { error: zeroErr } = await supabase
      .from("product_variants")
      .update({ amount: 0 })
      .eq("product_id", productId)
      .in(
        "variant_option_id",
        szMapEntries.map(([, id]) => id)
      );
    if (zeroErr) throw zeroErr;
  }

  // ---------------- CRUD básico de grupos/opções ----------------
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
      bumpMatrix(); // pode impactar a Grade
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

      const fresh = await reloadFor(productId);
      await loadSizeStockForProduct(productId, fresh.groups, fresh.options);
      bumpMatrix();
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

      const fresh = await reloadFor(productId);
      await loadSizeStockForProduct(productId, fresh.groups, fresh.options);
      bumpMatrix();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao salvar opção");
    }
  }
  async function deleteOption(optId: string) {
    if (!confirm("Remover opção?")) return;
    try {
      const { error } = await supabase.from("variant_options").delete().eq("id", optId);
      if (error) throw error;

      const fresh = await reloadFor(productId);
      await loadSizeStockForProduct(productId, fresh.groups, fresh.options);
      bumpMatrix();
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
          <Layers3 className="w-4 h-4" /> Tamanho (P, M, G, GG) • Cor (nome + hex)
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

      {/* CARD — Chips criam/removem na hora (Tamanho) */}
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
                Clique no tamanho para <b>criar/remover</b>.{" "}
                {hasColorGroup ? (
                  <>Como este produto tem <b>Cor</b>, o estoque por combinação é editado na <b>Grade</b> abaixo.</>
                ) : (
                  <>Edite a <b>quantidade</b> na lista do grupo <b>Tamanho</b> abaixo.</>
                )}
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

      {/* === Grade Tamanho × Cor === */}
      <div className="mb-6">
        <VariantMatrix productId={productId} accent={ACCENT} refreshToken={matrixRefresh} />
      </div>

      {/* Lista de grupos/opções existentes (retrátil) */}
      {warn && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5" />
          <div>{warn}</div>
        </div>
      )}

      {loadingData ? (
        <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">Carregando...</div>
      ) : (
        <div className="space-y-3">
          {productGroups.length === 0 ? (
            <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">
              Nenhum grupo criado.
            </div>
          ) : null}

          {productGroups.map((g) => {
            const size = g.id === sizeGroupId;
            const color = isColorName(g.name);
            return (
              <section key={g.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
                <header className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    {/* Botão retrátil */}
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapse(g.id)}
                      className="grid place-items-center w-7 h-7 rounded-md border border-gray-200 bg-white hover:bg-gray-50"
                      title={collapsed[g.id] ? "Expandir" : "Recolher"}
                    >
                      {collapsed[g.id] ? (
                        <ChevronRight className="w-4 h-4 text-gray-600" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-600" />
                      )}
                    </button>

                    {/* Ícone do grupo */}
                    <span className="grid place-items-center w-7 h-7 rounded-md bg-gray-100 border border-gray-200">
                      {color ? <Droplet className="w-4 h-4 text-gray-600" /> : <GripVertical className="w-4 h-4 text-gray-600" />}
                    </span>

                    {/* Título / edição inline */}
                    {g._editing ? (
                      <GroupEditInline
                        name={g.name}
                        onCancel={() => cancelEditGroup(g.id)}
                        onSave={(name) => saveEditGroup(g.id, name)}
                      />
                    ) : (
                      <h2 className="text-sm font-medium">
                        {g.name} {color && <span className="text-xs text-gray-500">(nome + hex)</span>}
                      </h2>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {g._editing ? null : (
                      <button
                        onClick={() => startEditGroup(g.id)}
                        className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white"
                        title="Renomear grupo"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => removeGroup(g.id)}
                      className="px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white"
                      title="Excluir grupo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </header>

                {/* Corpo do card: retrátil */}
                {!collapsed[g.id] && (
                  <OptionsList
                    groupId={g.id}
                    isSizeGroup={size}
                    isColorGroup={color}
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
                    setGlobalErr={setErr}
                    hideSizeQty={hasColorGroup} // esconde Qtd do grupo Tamanho quando houver Cor
                  />
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* === Card de Ativar Cor no rodapé (apenas quando ainda não existe) === */}
      {!hasColorGroup && productId && (
        <ActivateColorCard
          accent={ACCENT}
          onActivate={async ({ colorName, colorHex, migrate }) => {
            setErr(null);
            setOk(null);
            setWarn(null);
            try {
              if (!isValidHex(colorHex)) throw new Error("Informe um HEX válido (#RGB ou #RRGGBB).");
              const colorGroupId = await ensureColorGroup();
              const colorOptId = await createColorOption(colorGroupId, colorName || "Cor única", colorHex);

              // recarrega grupos/opções
              const fresh = await reloadFor(productId);
              await loadSizeStockForProduct(productId, fresh.groups, fresh.options);

              if (migrate) {
                await migrateSizeStockToSets(colorOptId);
                setOk("Variante 'Cor' ativada e estoque migrado para Tamanho × Cor.");
              } else {
                setOk("Variante 'Cor' ativada. Agora adicione combinações na Grade.");
              }

              bumpMatrix(); // força a Grade a refazer o fetch
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Falha ao ativar variante de cor");
            }
          }}
        />
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

/** Card de "Ativar Cor" com primeira cor + opção de migração */
function ActivateColorCard({
  accent,
  onActivate,
}: {
  accent: string;
  onActivate: (args: { colorName: string; colorHex: string; migrate: boolean }) => Promise<void>;
}) {
  const [name, setName] = React.useState("Preto");
  const [hex, setHex] = React.useState("#000000");
  const [migrate, setMigrate] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [localErr, setLocalErr] = React.useState<string | null>(null);

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <header className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="grid place-items-center w-7 h-7 rounded-md bg-gray-100 border border-gray-200">
            <Droplet className="w-4 h-4 text-gray-600" />
          </span>
          <h2 className="text-sm font-medium">Ativar variante de Cor</h2>
        </div>
      </header>

      <div className="p-3 space-y-3">
        <p className="text-xs text-gray-600">
          Este produto foi criado sem <b>Cor</b>. Ative a variante para controlar estoque por <b>Tamanho × Cor</b>.
          Opcionalmente, migre o estoque atual por tamanho para a cor criada.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cor (ex.: Preto)"
            className="flex-1 min-w-40 px-3 py-2 rounded-xl border border-gray-200"
          />
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              className="h-10 w-10 rounded-lg border border-gray-200 bg-white p-1"
              title="Escolher cor"
            />
            <input
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              placeholder="#RRGGBB"
              className={`w-32 px-3 py-2 rounded-xl border border-gray-200`}
            />
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={migrate} onChange={(e) => setMigrate(e.target.checked)} />
          Migrar estoque por Tamanho para esta cor
        </label>

        {localErr && <div className="text-xs text-red-600">{localErr}</div>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setLocalErr(null);
              try {
                if (!name.trim()) throw new Error("Informe o nome da cor.");
                if (!isValidHex(hex)) throw new Error("Hex inválido (#RGB ou #RRGGBB).");
                setBusy(true);
                await onActivate({ colorName: name.trim(), colorHex: hex.trim(), migrate });
              } catch (e) {
                setLocalErr(e instanceof Error ? e.message : "Falha ao ativar cor");
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-white text-sm"
            style={{ backgroundColor: accent }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            Ativar Cor
          </button>
        </div>
      </div>
    </section>
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
  isColorGroup,
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
  setGlobalErr,
  hideSizeQty,
}: {
  groupId: string;
  isSizeGroup: boolean;
  isColorGroup: boolean;
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

  setGlobalErr: (v: string | null) => void;
  hideSizeQty?: boolean;
}) {
  const [value, setValue] = React.useState<string>("");
  const [code, setCode] = React.useState<string>("");
  const [hexErr, setHexErr] = React.useState<string | null>(null);

  function toSizeKey(v: string): SizeKey | null {
    if (v === "P" || v === "M" || v === "G" || v === "GG") return v;
    return null;
  }

  function handleAdd() {
    if (!value.trim()) return;
    if (isColorGroup) {
      const hex = code.trim();
      if (!isValidHex(hex)) {
        setHexErr("Use um hex válido (#RGB ou #RRGGBB).");
        setGlobalErr(null);
        return;
      }
    }
    setHexErr(null);
    onAdd(groupId, value.trim(), code.trim() || undefined);
    setValue("");
    setCode("");
  }

  const COLOR_PRESETS: Array<{ name: string; hex: string }> = [
    { name: "Preto", hex: "#000000" },
    { name: "Branco", hex: "#FFFFFF" },
    { name: "Vermelho", hex: "#FF0000" },
    { name: "Azul", hex: "#0057FF" },
    { name: "Verde", hex: "#01A920" },
    { name: "Amarelo", hex: "#FFD400" },
    { name: "Rosa", hex: "#FF5DA2" },
    { name: "Roxo", hex: "#7F56D9" },
    { name: "Bege", hex: "#E7D9C9" },
    { name: "Cinza", hex: "#888888" },
  ];

  return (
    <div className="p-3">
      {/* Form inline para criar opção */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={isColorGroup ? "Cor (ex.: Vermelho)" : "Opção (ex.: Viscose)"}
          className="flex-1 min-w-40 px-3 py-2 rounded-xl border border-gray-200"
        />

        {isColorGroup ? (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={isValidHex(code) ? code : "#000000"}
              onChange={(e) => setCode(e.target.value)}
              className="h-10 w-10 rounded-lg border border-gray-200 bg-white p-1"
              title="Escolher cor"
            />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="#RRGGBB"
              className={`w-32 px-3 py-2 rounded-xl border ${hexErr ? "border-red-300" : "border-gray-200"}`}
            />
          </div>
        ) : (
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Código (opcional)"
            className="w-40 px-3 py-2 rounded-xl border border-gray-200"
          />
        )}

        <button
          onClick={handleAdd}
          className="px-3 py-2 rounded-xl text-white text-sm"
          style={{ backgroundColor: ACCENT }}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {isColorGroup && hexErr && <div className="text-xs text-red-600 mb-2">{hexErr}</div>}

      {/* Presets de cores */}
      {isColorGroup && (
        <div className="flex flex-wrap gap-2 mb-3">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => {
                setValue(c.name);
                setCode(c.hex);
                setHexErr(null);
              }}
              className="flex items-center gap-2 px-2 py-1 rounded-lg border border-gray-200 text-xs bg-white hover:bg-gray-50"
              title={`${c.name} ${c.hex}`}
            >
              <span
                className="inline-block w-4 h-4 rounded-full border"
                style={{ backgroundColor: c.hex, borderColor: "#e5e7eb" }}
              />
              {c.name}
            </button>
          ))}
        </div>
      )}

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
                  {isColorGroup ? (
                    <span
                      className="inline-block w-4 h-4 rounded-full border"
                      style={{ backgroundColor: o.code ?? "#FFFFFF", borderColor: "#e5e7eb" }}
                      title={o.code ?? "#FFFFFF"}
                    />
                  ) : (
                    <GripVertical className="w-4 h-4 text-gray-600" />
                  )}
                </span>
                <OptionInline opt={o} onSave={onSave} isColorGroup={isColorGroup} />
              </div>

              {/* Meio: QTD inline SOMENTE para Tamanho — e oculto se houver grupo Cor */}
              {isEditableSize && !hideSizeQty ? (
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

              {/* Direita: Lixeira — OCULTA no grupo Tamanho; visível nos demais (inclui Cor) */}
              {isEditableSize ? (
                <div className="w-4 h-4" /> // placeholder
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
  isColorGroup,
}: {
  opt: VariantOption;
  onSave: (optId: string, payload: Partial<VariantOption>) => void;
  isColorGroup: boolean;
}) {
  const [v, setV] = React.useState<string>(opt.value);
  const [c, setC] = React.useState<string>(opt.code || "");
  const [saving, setSaving] = React.useState<boolean>(false);
  const [hexErr, setHexErr] = React.useState<string | null>(null);

  async function handleSave() {
    if (!v.trim()) return;
    if (isColorGroup && c.trim()) {
      if (!isValidHex(c.trim())) {
        setHexErr("Hex inválido (#RGB ou #RRGGBB).");
        return;
      }
    }
    setSaving(true);
    try {
      await onSave(opt.id, { value: v.trim(), code: c.trim() || null });
    } finally {
      setSaving(false);
      setHexErr(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="px-2 py-1 rounded-lg border border-gray-200 text-sm"
        placeholder={isColorGroup ? "Cor (ex.: Azul Marinho)" : "Opção"}
      />

      {isColorGroup ? (
        <>
          <input
            type="color"
            value={isValidHex(c) ? c : "#000000"}
            onChange={(e) => setC(e.target.value)}
            className="h-9 w-9 rounded-md border border-gray-200 bg-white p-1"
            title="Escolher cor"
          />
          <input
            value={c}
            onChange={(e) => setC(e.target.value)}
            className={`w-28 px-2 py-1 rounded-lg border text-sm ${hexErr ? "border-red-300" : "border-gray-200"}`}
            placeholder="#RRGGBB"
          />
        </>
      ) : (
        <input
          value={c}
          onChange={(e) => setC(e.target.value)}
          className="w-28 px-2 py-1 rounded-lg border border-gray-200 text-sm"
          placeholder="Código"
        />
      )}

      <button onClick={handleSave} className="px-2 py-1 rounded-lg text-white text-xs" style={{ backgroundColor: ACCENT }}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      </button>

      {hexErr && <span className="text-xs text-red-600">{hexErr}</span>}
    </div>
  );
}
