from flask import Flask, render_template
from config import Config
from extensions import db, cors
from dotenv import load_dotenv

load_dotenv()

def create_app():
    app = Flask(
        __name__,
        template_folder="templates",
        static_folder="static"
    )

    app.config.from_object(Config)

    db.init_app(app)
    cors.init_app(app)

    from routes.auth import auth_bp
    from routes.inspection import inspection_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(inspection_bp)

    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/dashboard")
    def dashboard():
        return render_template("dashboard.html")

    with app.app_context():
        db.create_all()

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True)