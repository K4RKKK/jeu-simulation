/**
 * Un `ComponentType<T>` est un jeton typé : il porte l'identité d'un composant à
 * l'exécution (un index dense, utilisé comme clé de store) et son type à la compilation
 * (via le paramètre fantôme `__type`). C'est ce qui permet à `getComponent(id, Transform)`
 * de renvoyer `TransformComponent | undefined` sans aucun cast.
 */
export interface ComponentType<T> {
  readonly index: number;
  readonly name: string;
  /** Marqueur de type uniquement — jamais lu à l'exécution. */
  readonly __type?: T;
}

let nextComponentIndex = 0;

const registered = new Map<string, ComponentType<unknown>>();

export function defineComponent<T>(name: string): ComponentType<T> {
  if (registered.has(name)) {
    throw new Error(`Component "${name}" is already defined. Component names must be unique.`);
  }
  const type: ComponentType<T> = { index: nextComponentIndex++, name };
  registered.set(name, type as ComponentType<unknown>);
  return type;
}

/** Liste des composants déclarés — utilisée par les outils de debug et l'inspecteur. */
export function registeredComponentNames(): string[] {
  return [...registered.keys()];
}
