import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldValues, Resolver } from "react-hook-form";

/**
 * Wrapper determinístico do `zodResolver`.
 *
 * `@hookform/resolvers@5.4.0` fixa o literal de versão interno do zod em 4.0
 * (`_zod.version.minor: 0`), incompatível com `zod@4.4.3` (`minor: 4`). Esse erro
 * de tipo dispara de forma FLAKY no `tsc -b` — depende do estado do cache de
 * instanciação dos tipos recursivos do zod v4. Às vezes erra (TS2769), às vezes
 * some e um `@ts-expect-error` no call site vira "diretiva não-usada" (TS2578).
 * Logo, nem manter nem remover um `@ts-expect-error` é confiável (build verde
 * local quebrava no Cloudflare e vice-versa).
 *
 * O `as never` faz a chamada type-checar INCONDICIONALMENTE (never é atribuível a
 * qualquer parâmetro, sem comparar os tipos recursivos), e o cast de retorno
 * devolve o `Resolver<T>` que o `useForm<T>` espera. Determinístico em qualquer
 * cache/ambiente. Runtime intacto — só contorna o lapso de tipos do upstream.
 *
 * Remover quando `@hookform/resolvers` suportar zod 4.4 nos tipos.
 */
export function zResolver<T extends FieldValues>(schema: unknown): Resolver<T> {
	return zodResolver(schema as never) as unknown as Resolver<T>;
}
