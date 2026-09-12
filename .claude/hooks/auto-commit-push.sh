#!/usr/bin/env bash
# Hook Stop de Claude Code : à la fin de chaque réponse, un commit et un push par fichier modifié,
# supprimé ou non suivi, sur la branche courante. Ne fait rien s'il n'y a aucun changement, en plein
# merge ou rebase, ou en tête détachée.
set -u

cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$root" || exit 0
git_dir="$(git rev-parse --git-dir)"
branch="$(git symbolic-ref --short -q HEAD)" || exit 0
if [ -e "$git_dir/MERGE_HEAD" ] || [ -d "$git_dir/rebase-merge" ] || [ -d "$git_dir/rebase-apply" ]; then
  exit 0
fi
[ -n "$(git status --porcelain --untracked-files=all)" ] || exit 0

trailer='Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>'
remote="$(git config --get "branch.$branch.remote" || echo origin)"
committed=0
pushed=0
errors=()

push_branch() {
  if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    git push -q "$remote" "$branch" 2>/dev/null
  else
    git push -q -u "$remote" "$branch" 2>/dev/null
  fi
}

while IFS= read -r -d '' entry; do
  code="${entry:0:2}"
  path="${entry:3}"
  paths=("$path")
  case "$code" in
    R* | C*)
      # En -z, un renommage donne « XY nouveau\0ancien\0 ».
      IFS= read -r -d '' old || old=""
      paths=("$path" "$old")
      message="Renomme $old en $path"
      ;;
    D* | ?D) message="Supprime $path" ;;
    '??' | A*) message="Ajoute $path" ;;
    *) message="Met à jour $path" ;;
  esac

  # Chemin par chemin : l'ancien nom d'un renommage déjà indexé n'existe plus, et git add refuserait tout le lot.
  for p in "${paths[@]}"; do git add -A -- "$p" 2>/dev/null || true; done
  # Rien à commiter pour ce fichier (par exemple créé puis supprimé) : on passe.
  git diff --cached --quiet -- "${paths[@]}" && continue

  if git commit -q -m "$message" -m "$trailer" -- "${paths[@]}" >/dev/null 2>&1; then
    committed=$((committed + 1))
    if push_branch; then pushed=$((pushed + 1)); else errors+=("push de $path"); fi
  else
    errors+=("$path")
  fi
done < <(git status --porcelain -z --untracked-files=all)

[ "$committed" -gt 0 ] || [ "${#errors[@]}" -gt 0 ] || exit 0
summary="Push auto : $committed commit(s), $pushed push sur $branch"
[ "${#errors[@]}" -gt 0 ] && summary="$summary · échecs : ${errors[*]}"
python3 -c 'import json, sys; print(json.dumps({"systemMessage": sys.argv[1]}, ensure_ascii=False))' "$summary" 2>/dev/null ||
  printf '{"systemMessage": "Push auto terminé"}\n'
exit 0
