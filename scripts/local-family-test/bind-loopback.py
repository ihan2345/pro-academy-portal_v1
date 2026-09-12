"""Limit only this test stack's published Docker ports to loopback before importing PII."""
import http.client
import json
import socket
import subprocess
import urllib.parse

endpoint = subprocess.check_output(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], text=True).strip()
if not endpoint.startswith('unix://'):
    raise SystemExit('Only local Docker socket permitted')

class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect(endpoint[7:])

def api(method, path, body=None, raw=False):
    conn = DockerConnection('localhost', timeout=90)
    conn.request(method, '/v1.45' + path, body if isinstance(body, bytes) else json.dumps(body).encode() if body else None, {'Content-Type': 'application/x-tar' if isinstance(body, bytes) else 'application/json'})
    response = conn.getresponse()
    data = response.read()
    if response.status >= 400:
        raise RuntimeError(f'Docker {method} {path}: {response.status} {data.decode()[:200]}')
    conn.close()
    return data if raw else json.loads(data) if data else None

containers = api('GET', '/containers/json?all=1')
for container in containers:
    names = container['Names']
    if len(names) != 1 or not names[0].endswith('_pabyak-family-local'):
        continue
    name = names[0][1:]
    info = api('GET', f'/containers/{name}/json')
    bindings = info['HostConfig'].get('PortBindings') or {}
    enable_local_password_login = name.startswith('supabase_auth_') and 'GOTRUE_EXTERNAL_EMAIL_ENABLED=false' in info['Config']['Env']
    if not enable_local_password_login and (not bindings or all(b.get('HostIp') == '127.0.0.1' for entries in bindings.values() for b in entries)):
        continue
    # The CLI writes gateway certificates/configuration to the writable layer.
    gateway_files = api('GET', f'/containers/{name}/archive?path=/home/kong', raw=True) if name.startswith('supabase_kong_') else None
    for entries in bindings.values():
        for binding in entries:
            binding['HostIp'] = '127.0.0.1'
    host = info['HostConfig']
    host['PortBindings'] = bindings
    # Preserve existing data volumes by name; never recreate empty anonymous volumes.
    host['Binds'] = [f"{m.get('Name') or m['Source']}:{m['Destination']}:{'rw' if m['RW'] else 'ro'}" for m in info['Mounts'] if m['Type'] in ('volume', 'bind')]
    host.pop('Mounts', None)
    payload = dict(info['Config'])
    if enable_local_password_login:
        payload['Env'] = ['GOTRUE_EXTERNAL_EMAIL_ENABLED=true' if e == 'GOTRUE_EXTERNAL_EMAIL_ENABLED=false' else e for e in payload['Env']]
        if 'GOTRUE_DISABLE_SIGNUP=true' not in payload['Env']:
            raise RuntimeError('Public signup must remain disabled')
    payload['HostConfig'] = host
    payload['NetworkingConfig'] = {'EndpointsConfig': {n: {'Aliases': [a for a in (v.get('Aliases') or []) if a != info['Id'][:12]]} for n, v in info['NetworkSettings']['Networks'].items()}}
    if info['State']['Running']:
        api('POST', f'/containers/{name}/stop?t=15')
    api('DELETE', f'/containers/{name}')
    api('POST', '/containers/create?name=' + urllib.parse.quote(name), payload)
    if gateway_files:
        api('PUT', f'/containers/{name}/archive?path=/home', gateway_files)
    api('POST', f'/containers/{name}/start')
    print(f'{name}: published ports bound to 127.0.0.1')

for container in api('GET', '/containers/json'):
    if any(n.endswith('_pabyak-family-local') for n in container['Names']):
        if any(p.get('PublicPort') and p.get('IP') != '127.0.0.1' for p in container['Ports']):
            raise RuntimeError('A test port is not loopback-only')
print('Local test stack: all published ports are loopback-only.')
