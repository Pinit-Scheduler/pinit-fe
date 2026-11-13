import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const transpile = (path) =>
  ts.transpileModule(readFileSync(new URL('../../src/' + path, import.meta.url), 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText

const run = (path, require, globals = {}) => {
  const module = { exports: {} }
  vm.runInNewContext(transpile(path), { module, exports: module.exports, require, ...globals })
  return module.exports
}

/** An element tree node: what the jsx mock returns instead of rendering. */
const element = (type, props, key) => ({ type, props, key: key ?? null })

/** Depth-first search through element children for the first node that matches. */
export const findElement = (node, match) => {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, match)
      if (found) return found
    }
    return null
  }
  if (match(node)) return node
  return findElement(node.props?.children, match)
}

/**
 * A hook runtime that behaves like React for render-phase updates: a setState called while the
 * component renders makes it render again before anything below it sees the value. Effects do not run.
 */
export const hookRuntime = () => {
  const state = []
  let cursor = 0
  let rendering = false
  let dirty = false
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useState: (initial) => {
      const index = cursor++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [
        state[index],
        (next) => {
          state[index] = typeof next === 'function' ? next(state[index]) : next
          if (rendering) dirty = true
        },
      ]
    },
    useEffect() {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (initial) => react.useState(() => ({ current: initial }))[0],
  }
  const render = (component, props = {}) => {
    let value
    let passes = 0
    do {
      dirty = false
      cursor = 0
      rendering = true
      value = component(props)
      rendering = false
      assert.ok(++passes < 10, 'render loop')
    } while (dirty)
    return value
  }
  return { react, render }
}

/**
 * src/app/App.tsx with its hooks on `runtime` and its pages stubbed. Returns the components the
 * app defines, found through the tree it builds: AppContent and the /app/* WorkspaceRoutes.
 */
export const loadApp = (runtime, dependencies = {}) => {
  let routes = null
  const stubs = new Map()
  const stub = (name) => {
    if (!stubs.has(name)) stubs.set(name, Object.assign(() => null, { displayName: name }))
    return stubs.get(name)
  }
  const routeSurfaceState = run('shared/routing/routeSurfaceState.ts', () => ({}))
  const router = {
    createBrowserRouter: (config) => {
      routes = config
      return 'router'
    },
    Navigate: stub('Navigate'),
    Route: stub('Route'),
    RouterProvider: stub('RouterProvider'),
    Routes: stub('Routes'),
    useLocation: () => assert.fail('useLocation is not provided'),
    useNavigationType: () => 'POP',
    ...dependencies['react-router-dom'],
  }
  const provided = {
    react: runtime.react,
    'react/jsx-runtime': { jsx: element, jsxs: element },
    '@shared/routing/routeSurfaceState': routeSurfaceState,
    '@shared/routing/viewTransitionNavigation': { registerTransitionNavigate() {} },
    '@shared/motion/usePresence': {
      usePresence: (value) => ({ mounted: Boolean(value), closing: false, value: value ?? undefined }),
    },
    '@features/spaces/store': { useWorkspaceEvents() {} },
    ...dependencies,
  }
  provided['react-router-dom'] = router
  const require = (name) => {
    if (name in provided) return provided[name]
    if (name.endsWith('.css')) return {}
    // Pages, providers and other components: named stubs, so the tree says which one it holds.
    return new Proxy({}, { get: (_, key) => (key === '__esModule' ? true : stub(`${name}#${String(key)}`)) })
  }
  const App = run('app/App.tsx', require, { window: new EventTarget() }).default
  const AppContent = App().props.children.type
  const AppRoutes = routes[0].element.type
  const workspace = findElement(AppRoutes(), (node) => node.props?.path === '/app/*')
  return { AppContent, WorkspaceRoutes: workspace.props.element.type, stub }
}
