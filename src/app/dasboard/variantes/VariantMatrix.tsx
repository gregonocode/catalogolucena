"use client";

import React from "react";
import { Loader2, Check } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type VariantGroup = {
  id: string;
  product_id: string;
  name: string;
  position: number;
};

type VariantOption = {
  id: string;
  variant_group_id: string;
  value: string;
  code: string | null; // para Cor: hex
  position: number;
};

type PVSOptionLink = {
  variant_option_id: string;
};

type ProductVariantSet = {
  id: string;
  amount: number | null;
  product_variant_set_options: PVSOptionLink[];
};

type SizeKey = "P" | "M" | "G" | "GG";
const SIZE_LABELS: SizeKey[] = ["P", "M", "G", "GG"];

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const isSizeName = (name: string) => norm(name) === "tamanho";
const isColorName = (name: string) => norm(name) === "cor";

type MatrixCell = { setId?: string; amount: number };

// ✅ Seu schema usa `set_id` no vínculo
type PVSOLinkInsert = { set_id: string; variant_option_id: string };

function friendlyError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const maybe = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const msg = typeof maybe.message === "string" ? maybe.message : "";
    const det = typeof maybe.details === "string" ? maybe.details : "";
    const hint = typeof maybe.hint === "string" ? maybe.hint : "";
    const code = typeof maybe.code === "string" ? maybe.code : "";
    const parts = [msg, det, hint, code].filter(Boolean);
    if (parts.length) return parts.join(" — ");
  }
  return "Erro desconhecido";
}

export function VariantMatrix({
  productId,
  accent = "#01A920",
  refreshToken = 0,
}: {
  productId: string;
  accent?: string;
  refreshToken?: number;
}) {
  const supabase = supabaseBrowser();

  const [loading, setLoading] = React.useState<boolean>(true);
  const [err, setErr] = React.useState<string | null>(null);

  const [sizeGroup, setSizeGroup] = React.useState<VariantGroup | null>(null);
  const [colorGroup, setColorGroup] = React.useState<VariantGroup | null>(null);
  const [sizes, setSizes] = React.useState<VariantOption[]>([]);
  const [colors, setColors] = React.useState<VariantOption[]>([]);

  // key: `${sizeId}::${colorId}` -> { setId?, amount }
  const [cells, setCells] = React.useState<Record<string, MatrixCell>>({});
  const [savingKey, setSavingKey] = React.useState<string | null>(null);
  const [initializing, setInitializing] = React.useState<boolean>(false);

  const fetchAll = React.useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setErr(null);

    try {
      // 1) grupos
      const { data: gdata, error: gerr } = await supabase
        .from("variant_groups")
        .select("id, product_id, name, position")
        .eq("product_id", productId)
        .order("position", { ascending: true });

      if (gerr) throw gerr;

      const sg = (gdata ?? []).find((g) => isSizeName(g.name)) ?? null;
      const cg = (gdata ?? []).find((g) => isColorName(g.name)) ?? null;
      setSizeGroup(sg);
      setColorGroup(cg);

      if (!sg || !cg) {
        setSizes([]);
        setColors([]);
        setCells({});
        setLoading(false);
        return;
      }

      // 2) opções
      const { data: odata, error: oerr } = await supabase
        .from("variant_options")
        .select("id, variant_group_id, value, code, position")
        .in("variant_group_id", [sg.id, cg.id])
        .order("position", { ascending: true })
        .order("id", { ascending: true });

      if (oerr) throw oerr;

      const all = (odata ?? []) as VariantOption[];
      const sOpts = all
        .filter((o) => o.variant_group_id === sg.id)
        .filter((o) => SIZE_LABELS.includes(o.value as SizeKey));
      const cOpts = all.filter((o) => o.variant_group_id === cg.id);

      setSizes(sOpts);
      setColors(cOpts);

      // 3) sets + links
      const { data: setsRaw, error: setsErr } = await supabase
        .from("product_variant_sets")
        .select(
          `
          id,
          amount,
          product_variant_set_options (
            variant_option_id
          )
        `
        )
        .eq("product_id", productId);

      if (setsErr) throw setsErr;

      const sets = (setsRaw ?? []) as ProductVariantSet[];

      // 4) mapa size×color → set
      const map: Record<string, MatrixCell> = {};
      const sIds = new Set(sOpts.map((o) => o.id));
      const cIds = new Set(cOpts.map((o) => o.id));

      for (const s of sets) {
        const linked = s.product_variant_set_options ?? [];
        const optIds = linked.map((x) => x.variant_option_id);

        const sid = optIds.find((id) => sIds.has(id));
        const cid = optIds.find((id) => cIds.has(id));
        if (!sid || !cid) continue;

        map[`${sid}::${cid}`] = { setId: s.id, amount: Number(s.amount ?? 0) };
      }

      // 5) preencher faltantes com 0
      for (const so of sOpts) {
        for (const co of cOpts) {
          const k = `${so.id}::${co.id}`;
          if (!map[k]) map[k] = { amount: 0 };
        }
      }

      setCells(map);
      setLoading(false);
    } catch (e) {
      setErr(friendlyError(e));
      setLoading(false);
    }
  }, [productId, supabase]);

  React.useEffect(() => {
    fetchAll();
  }, [fetchAll, productId, refreshToken]);

  const upsertCell = React.useCallback(
    async (sizeId: string, colorId: string) => {
      const key = `${sizeId}::${colorId}`;
      const cell = cells[key];
      if (!cell) return;

      setSavingKey(key);
      setErr(null);

      try {
        const nextAmount = Math.max(0, Math.trunc(cell.amount));

        if (cell.setId) {
          // update
          const { error } = await supabase
            .from("product_variant_sets")
            .update({ amount: nextAmount })
            .eq("id", cell.setId);

          if (error) throw error;
          setSavingKey(null);
          return;
        }

        // create set
        const { data: created, error: createErr } = await supabase
          .from("product_variant_sets")
          .insert({ product_id: productId, amount: nextAmount })
          .select("id")
          .single<{ id: string }>();
        if (createErr) throw createErr;

        const setId = created.id;

        // vincular opções (✅ usando set_id)
        const payload: PVSOLinkInsert[] = [
          { set_id: setId, variant_option_id: sizeId },
          { set_id: setId, variant_option_id: colorId },
        ];

        const { error: linkErr } = await supabase
          .from("product_variant_set_options")
          .insert(payload);
        if (linkErr) throw linkErr;

        setCells((m) => ({ ...m, [key]: { ...m[key], setId } }));
        setSavingKey(null);
      } catch (e) {
        console.error("VariantMatrix upsertCell error:", e);
        setSavingKey(null);
        setErr(friendlyError(e));
      }
    },
    [cells, productId, supabase]
  );

  const initAllMissing = React.useCallback(async () => {
    if (!sizeGroup || !colorGroup) return;
    setInitializing(true);
    setErr(null);

    try {
      for (const so of sizes) {
        for (const co of colors) {
          const key = `${so.id}::${co.id}`;
          const cell = cells[key];
          if (!cell || cell.setId) continue;

          const amount = Math.max(0, Math.trunc(cell.amount ?? 0));

          const { data: created, error: createErr } = await supabase
            .from("product_variant_sets")
            .insert({ product_id: productId, amount })
            .select("id")
            .single<{ id: string }>();
          if (createErr) throw createErr;

          const setId = created.id;

          // vincular opções (✅ usando set_id)
          const payload: PVSOLinkInsert[] = [
            { set_id: setId, variant_option_id: so.id },
            { set_id: setId, variant_option_id: co.id },
          ];

          const { error: linkErr } = await supabase
            .from("product_variant_set_options")
            .insert(payload);
          if (linkErr) throw linkErr;

          setCells((m) => ({ ...m, [key]: { ...m[key], setId } }));
        }
      }
    } catch (e) {
      console.error("VariantMatrix initAllMissing error:", e);
      setErr(friendlyError(e));
    } finally {
      setInitializing(false);
    }
  }, [cells, colorGroup, sizeGroup, sizes, colors, productId, supabase]);

  if (!sizeGroup || !colorGroup) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <header className="px-3 py-2 border-b border-gray-100">
          <h3 className="text-sm font-medium">Grade Tamanho × Cor</h3>
        </header>
        <div className="p-3 text-sm text-gray-600">
          Crie os grupos <b>Tamanho</b> e <b>Cor</b> para usar a grade.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <header className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <h3 className="text-sm font-medium">Grade Tamanho × Cor</h3>
        <button
          type="button"
          onClick={initAllMissing}
          disabled={initializing || loading}
          className="px-3 py-1.5 rounded-lg text-white text-xs"
          style={{ backgroundColor: accent }}
          title="Criar combinações faltantes com quantidade 0"
        >
          {initializing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Criar entradas faltantes"}
        </button>
      </header>

      {loading ? (
        <div className="p-3 text-sm text-gray-600">Carregando grade...</div>
      ) : (
        <div className="p-3 overflow-x-auto">
          <div className="inline-block min-w-full align-middle">
            <table className="min-w-full border-separate border-spacing-y-2">
              <thead>
                <tr>
                  <th className="text-left text-xs text-gray-500 px-2 py-1">Tamanho</th>
                  {colors.map((c) => (
                    <th key={c.id} className="text-center text-xs text-gray-500 px-2 py-1">
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className="inline-block w-4 h-4 rounded-full border"
                          style={{ backgroundColor: c.code ?? "#ffffff", borderColor: "#e5e7eb" }}
                          title={c.code ?? "#ffffff"}
                        />
                        <span className="truncate max-w-[120px]">{c.value}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sizes.map((s) => (
                  <tr key={s.id}>
                    <td className="text-sm font-medium text-gray-800 px-2 py-1">{s.value}</td>
                    {colors.map((c) => {
                      const k = `${s.id}::${c.id}`;
                      const cell = cells[k] ?? { amount: 0 };
                      const busy = savingKey === k;
                      return (
                        <td key={k} className="px-2 py-1">
                          <div className="flex items-center justify-center gap-2">
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={cell.amount}
                              onChange={(e) => {
                                const n = Math.max(0, Math.trunc(Number(e.target.value)));
                                setCells((m) => ({
                                  ...m,
                                  [k]: { ...m[k], amount: Number.isNaN(n) ? 0 : n },
                                }));
                              }}
                              className="w-20 px-2 py-1 rounded-lg border border-gray-200 bg-white text-sm text-center"
                            />
                            <button
                              type="button"
                              onClick={() => upsertCell(s.id, c.id)}
                              disabled={busy}
                              className="px-2 py-1 rounded-lg text-white text-xs"
                              style={{ backgroundColor: accent }}
                              title="Salvar quantidade"
                            >
                              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {err && <div className="mt-3 text-sm text-red-600">{err}</div>}
          </div>
        </div>
      )}
    </section>
  );
}
