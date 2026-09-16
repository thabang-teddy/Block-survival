/// The sign-in page — twin of `Pages/Login.tsx` + `ui/AccountForm.tsx`. The
/// only thing a signed-out player sees; accounts come from the admin, there is
/// nothing to register. The web's dev-only guest button has no API equivalent
/// and is not offered here.
library;

import 'package:block_survival/app/session.dart';
import 'package:block_survival/app/settings.dart';
import 'package:block_survival/ui/theme.dart';
import 'package:flutter/material.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, required this.session});

  final AppSession session;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  late final _server = TextEditingController(
    text: widget.session.serverUrl.toString(),
  );
  bool _busy = false;
  String _serverError = '';

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _server.dispose();
    super.dispose();
  }

  bool get _canSubmit =>
      !_busy &&
      _email.text.isNotEmpty &&
      _password.text.isNotEmpty &&
      _server.text.trim().isNotEmpty;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    final url = parseServerUrl(_server.text);
    if (url == null) {
      setState(
        () => _serverError = 'Enter the server as http(s)://host[:port]',
      );
      return;
    }
    setState(() {
      _serverError = '';
      _busy = true;
    });
    await widget.session.setServerUrl(url);
    await widget.session.signIn(
      email: _email.text.trim(),
      password: _password.text,
    );
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return MenuCard(
      maxWidth: 480,
      children: [
        const Text(
          "Sign in to play — solo, host a room, or join a friend's. "
          'No account yet? Ask the admin for one.',
        ),
        const SizedBox(height: 16),
        AutofillGroup(
          child: Column(
            children: [
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                autofocus: true,
                decoration: const InputDecoration(hintText: 'Email'),
                onChanged: (_) => setState(() {}),
                onSubmitted: (_) => _submit(),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _password,
                obscureText: true,
                autofillHints: const [AutofillHints.password],
                decoration: const InputDecoration(hintText: 'Password'),
                onChanged: (_) => setState(() {}),
                onSubmitted: (_) => _submit(),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            onPressed: _canSubmit ? _submit : null,
            child: Text(_busy ? '…' : 'Sign in'),
          ),
        ),
        ListenableBuilder(
          listenable: widget.session,
          builder: (_, _) => ErrorLine(widget.session.lastError),
        ),
        const SizedBox(height: 16),
        const Fine('Server'),
        const SizedBox(height: 4),
        TextField(
          controller: _server,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: const InputDecoration(
            hintText: 'https://your-server.example',
          ),
          onChanged: (_) => setState(() {}),
          onSubmitted: (_) => _submit(),
        ),
        ErrorLine(_serverError),
        const Fine(
          'Where the game is hosted — the address you open in the browser.',
        ),
      ],
    );
  }
}
